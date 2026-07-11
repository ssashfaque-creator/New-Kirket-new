import CoreGraphics
import CoreMedia
import Foundation
import simd

enum TrajectoryFitError: LocalizedError {
    case cameraPoseUnavailable
    case insufficientSamples
    case invalidBallRadius
    case implausibleSpeed

    var errorDescription: String? {
        switch self {
        case .cameraPoseUnavailable:
            "Metric target pose is unavailable."
        case .insufficientSamples:
            "At least six reliable post-contact ball samples are required."
        case .invalidBallRadius:
            "Ball radius could not produce stable depth."
        case .implausibleSpeed:
            "The fitted speed is physically implausible."
        }
    }
}

struct TrajectoryFitter {
    static let gravity = 9.81

    func fit(
        observations: [BallObservation],
        contactTime: CMTime,
        calibration: CalibrationSolution,
        ballDiameterMeters: Double
    ) throws -> NativeShotMeasurement {
        guard let cameraToWorld = calibration.cameraToWorld else {
            throw TrajectoryFitError.cameraPoseUnavailable
        }
        let postContact = observations
            .filter { $0.presentationTime >= contactTime && $0.confidence >= 0.4 }
            .compactMap { observation -> WorldBallSample? in
                guard let position = worldPosition(
                    observation: observation,
                    calibration: calibration,
                    cameraToWorld: cameraToWorld,
                    ballDiameterMeters: ballDiameterMeters
                ) else {
                    return nil
                }
                return WorldBallSample(
                    timeSeconds: CMTimeGetSeconds(observation.presentationTime - contactTime),
                    positionMeters: position,
                    confidence: observation.confidence
                )
            }
        guard postContact.count >= 6 else { throw TrajectoryFitError.insufficientSamples }

        var inliers = postContact
        var model = fitLinearBallistic(inliers)
        for _ in 0..<3 {
            let residuals = inliers.map { residual(sample: $0, model: model) }
            let median = residuals.sorted()[residuals.count / 2]
            let threshold = max(0.06, median * 3.5)
            let filtered = zip(inliers, residuals)
                .filter { $0.1 <= threshold }
                .map(\.0)
            guard filtered.count >= 6 else { break }
            inliers = filtered
            model = fitLinearBallistic(inliers)
        }

        let residuals = inliers.map { residual(sample: $0, model: model) }
        let rms = sqrt(residuals.map { $0 * $0 }.reduce(0, +) / Double(inliers.count))
        let horizontalSpeed = hypot(model.velocity.x, model.velocity.y)
        let speed = simd_length(model.velocity)
        guard speed >= 2, speed <= 75 else { throw TrajectoryFitError.implausibleSpeed }

        let direction = normalizedDegrees(atan2(model.velocity.x, model.velocity.y) * 180 / .pi)
        let launch = atan2(model.velocity.z, max(horizontalSpeed, 1e-9)) * 180 / .pi
        let meanTrackConfidence = inliers.map(\.confidence).reduce(0, +) / Double(inliers.count)
        let residualScore = max(0, 1 - rms / 0.25)
        let calibrationScore = max(0, 1 - calibration.reprojectionErrorPixels / 3)
        let confidence = min(
            0.98,
            meanTrackConfidence * 0.45 + residualScore * 0.35 + calibrationScore * 0.2
        )
        var warnings: [String] = []
        if rms > 0.12 { warnings.append("Ballistic residual exceeds 12 cm.") }
        if inliers.count < postContact.count {
            warnings.append("\(postContact.count - inliers.count) trajectory outliers were rejected.")
        }

        return NativeShotMeasurement(
            speedMetersPerSecond: speed,
            directionDegrees: direction,
            launchAngleDegrees: launch,
            impactTime: contactTime,
            fitResidualMeters: rms,
            confidence: confidence,
            samples: inliers,
            warnings: warnings
        )
    }

    private func worldPosition(
        observation: BallObservation,
        calibration: CalibrationSolution,
        cameraToWorld: simd_double4x4,
        ballDiameterMeters: Double
    ) -> SIMD3<Double>? {
        guard observation.radiusPixels >= 1.5, ballDiameterMeters > 0 else { return nil }
        let intrinsics = calibration.cameraIntrinsics
        let fx = intrinsics.columns.0.x
        let fy = intrinsics.columns.1.y
        let cx = intrinsics.columns.2.x
        let cy = intrinsics.columns.2.y
        guard fx > 0, fy > 0 else { return nil }
        let depth = fx * (ballDiameterMeters / 2) / observation.radiusPixels
        let camera = SIMD4(
            (Double(observation.centerPixels.x) - cx) * depth / fx,
            (Double(observation.centerPixels.y) - cy) * depth / fy,
            depth,
            1
        )
        let world = cameraToWorld * camera
        guard world.w != 0 else { return nil }
        return SIMD3(world.x / world.w, world.y / world.w, world.z / world.w)
    }

    private struct BallisticModel {
        let origin: SIMD3<Double>
        let velocity: SIMD3<Double>
    }

    private func fitLinearBallistic(_ samples: [WorldBallSample]) -> BallisticModel {
        let x = weightedLine(samples.map { ($0.timeSeconds, $0.positionMeters.x, $0.confidence) })
        let y = weightedLine(samples.map { ($0.timeSeconds, $0.positionMeters.y, $0.confidence) })
        let z = weightedLine(samples.map {
            (
                $0.timeSeconds,
                $0.positionMeters.z + 0.5 * Self.gravity * $0.timeSeconds * $0.timeSeconds,
                $0.confidence
            )
        })
        return BallisticModel(
            origin: SIMD3(x.intercept, y.intercept, z.intercept),
            velocity: SIMD3(x.slope, y.slope, z.slope)
        )
    }

    private func residual(sample: WorldBallSample, model: BallisticModel) -> Double {
        let t = sample.timeSeconds
        let predicted = model.origin + model.velocity * t + SIMD3(0, 0, -0.5 * Self.gravity * t * t)
        return simd_distance(predicted, sample.positionMeters)
    }

    private func weightedLine(
        _ samples: [(time: Double, value: Double, weight: Double)]
    ) -> (intercept: Double, slope: Double) {
        let weightSum = samples.map(\.weight).reduce(0, +)
        let meanTime = samples.map { $0.time * $0.weight }.reduce(0, +) / weightSum
        let meanValue = samples.map { $0.value * $0.weight }.reduce(0, +) / weightSum
        let numerator = samples.map {
            $0.weight * ($0.time - meanTime) * ($0.value - meanValue)
        }.reduce(0, +)
        let denominator = samples.map {
            $0.weight * ($0.time - meanTime) * ($0.time - meanTime)
        }.reduce(0, +)
        let slope = numerator / max(denominator, 1e-12)
        return (meanValue - slope * meanTime, slope)
    }

    private func normalizedDegrees(_ value: Double) -> Double {
        let normalized = value.truncatingRemainder(dividingBy: 360)
        return normalized < 0 ? normalized + 360 : normalized
    }
}
