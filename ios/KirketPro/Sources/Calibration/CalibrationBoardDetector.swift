import CoreGraphics
import CoreMedia
import Foundation
import ImageIO
import Vision
import simd

struct MetricTargetObservation: Sendable {
    let cornersPixels: [CGPoint] // bottom-left, bottom-right, top-right, top-left
    let confidence: Double
    let imageSize: CGSize
}

final class CalibrationBoardDetector {
    static let payload = "KIRKET_METRIC_TARGET_V1_SIZE_160MM_STUMP_EDGE_BOTTOM"
    static let targetSideMeters = 0.160

    func detect(
        pixelBuffer: CVPixelBuffer,
        orientation: CGImagePropertyOrientation
    ) throws -> MetricTargetObservation? {
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        let handler = VNImageRequestHandler(
            cvPixelBuffer: pixelBuffer,
            orientation: orientation,
            options: [:]
        )
        try handler.perform([request])
        guard let barcode = request.results?
            .compactMap({ $0 as? VNBarcodeObservation })
            .filter({ $0.payloadStringValue == Self.payload })
            .max(by: { $0.confidence < $1.confidence })
        else {
            return nil
        }

        let rawWidth = CGFloat(CVPixelBufferGetWidth(pixelBuffer))
        let rawHeight = CGFloat(CVPixelBufferGetHeight(pixelBuffer))
        let swapsAxes = orientation == .left || orientation == .leftMirrored ||
            orientation == .right || orientation == .rightMirrored
        let width = swapsAxes ? rawHeight : rawWidth
        let height = swapsAxes ? rawWidth : rawHeight
        func pixels(_ point: CGPoint) -> CGPoint {
            CGPoint(x: point.x * width, y: (1 - point.y) * height)
        }

        return MetricTargetObservation(
            cornersPixels: [
                pixels(barcode.bottomLeft),
                pixels(barcode.bottomRight),
                pixels(barcode.topRight),
                pixels(barcode.topLeft),
            ],
            confidence: Double(barcode.confidence),
            imageSize: CGSize(width: width, height: height)
        )
    }
}

struct MetricCalibrationAccumulator {
    private(set) var observations: [MetricTargetObservation] = []
    let requiredFrames: Int

    init(requiredFrames: Int = 15) {
        self.requiredFrames = requiredFrames
    }

    mutating func append(_ observation: MetricTargetObservation) {
        guard observation.confidence >= 0.65 else { return }
        observations.append(observation)
        if observations.count > requiredFrames * 2 {
            observations.removeFirst()
        }
    }

    mutating func reset() {
        observations.removeAll()
    }

    func solve(cameraIntrinsics: simd_double3x3) throws -> CalibrationSolution? {
        guard observations.count >= requiredFrames else { return nil }
        let corners = medianCorners(observations)
        let half = CalibrationBoardDetector.targetSideMeters / 2
        // The target's bottom edge touches the middle stump. +Y points down the pitch.
        let ground = [
            CGPoint(x: -half, y: 0),
            CGPoint(x: half, y: 0),
            CGPoint(x: half, y: CalibrationBoardDetector.targetSideMeters),
            CGPoint(x: -half, y: CalibrationBoardDetector.targetSideMeters),
        ]
        let imageToGround = try Homography.solve(source: corners, destination: ground)
        let groundToImage = try Homography.inverse(imageToGround)
        let residual = temporalCornerRMS(observations, median: corners)
        let cameraToWorld = decomposeCameraPose(
            groundToImage: groundToImage,
            intrinsics: cameraIntrinsics
        )

        return CalibrationSolution(
            imageToGround: imageToGround,
            groundToImage: groundToImage,
            cameraIntrinsics: cameraIntrinsics,
            cameraToWorld: cameraToWorld,
            reprojectionErrorPixels: residual,
            targetCornersPixels: corners,
            targetSizeMeters: CGSize(
                width: CalibrationBoardDetector.targetSideMeters,
                height: CalibrationBoardDetector.targetSideMeters
            ),
            createdAt: Date()
        )
    }

    private func medianCorners(_ values: [MetricTargetObservation]) -> [CGPoint] {
        (0..<4).map { cornerIndex in
            CGPoint(
                x: CGFloat(median(values.map { Double($0.cornersPixels[cornerIndex].x) })),
                y: CGFloat(median(values.map { Double($0.cornersPixels[cornerIndex].y) }))
            )
        }
    }

    private func temporalCornerRMS(
        _ values: [MetricTargetObservation],
        median corners: [CGPoint]
    ) -> Double {
        let squaredErrors = values.flatMap { observation in
            (0..<4).map { index in
                let dx = Double(observation.cornersPixels[index].x - corners[index].x)
                let dy = Double(observation.cornersPixels[index].y - corners[index].y)
                return dx * dx + dy * dy
            }
        }
        return sqrt(squaredErrors.reduce(0, +) / Double(max(squaredErrors.count, 1)))
    }

    private func median(_ values: [Double]) -> Double {
        let sorted = values.sorted()
        let middle = sorted.count / 2
        if sorted.count.isMultiple(of: 2) {
            return (sorted[middle - 1] + sorted[middle]) / 2
        }
        return sorted[middle]
    }

    private func decomposeCameraPose(
        groundToImage: simd_double3x3,
        intrinsics: simd_double3x3
    ) -> simd_double4x4? {
        let determinant = simd_determinant(intrinsics)
        guard abs(determinant) > 1e-12 else { return nil }
        let normalized = intrinsics.inverse * groundToImage
        let b1 = normalized.columns.0
        let b2 = normalized.columns.1
        let b3 = normalized.columns.2
        let scale = 2 / max(simd_length(b1) + simd_length(b2), 1e-12)
        let r1 = simd_normalize(b1 * scale)
        let r2Raw = b2 * scale - simd_dot(b2 * scale, r1) * r1
        guard simd_length(r2Raw) > 1e-9 else { return nil }
        let r2 = simd_normalize(r2Raw)
        let r3 = simd_normalize(simd_cross(r1, r2))
        let translation = b3 * scale
        let worldToCamera = simd_double4x4(
            SIMD4(r1.x, r1.y, r1.z, 0),
            SIMD4(r2.x, r2.y, r2.z, 0),
            SIMD4(r3.x, r3.y, r3.z, 0),
            SIMD4(translation.x, translation.y, translation.z, 1)
        )
        let cameraToWorld = worldToCamera.inverse
        guard cameraToWorld.columns.3.z.isFinite else { return nil }
        return cameraToWorld
    }
}
