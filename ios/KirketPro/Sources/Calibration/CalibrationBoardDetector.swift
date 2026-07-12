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

/// Single source of truth for how the metric target is printed and placed.
/// The 3×3 A4 board is a visibility/assembly aid; only sheet C2's QR is measured.
enum MetricCalibrationProtocol {
    static let payload = "KIRKET_METRIC_TARGET_V1_SIZE_160MM_STUMP_EDGE_BOTTOM"
    /// Side length Vision returns for the QR *symbol* (modules only), in meters.
    /// Quiet zone is printed outside this square and must not be included here.
    static let targetSideMeters = 0.160
    /// Sheet ID that carries the QR on the 3×3 board (front-middle, camera side).
    static let qrSheetId = "C2"
    /// Vertical offset from QR bottom edge to middle stump. Must stay 0:
    /// ground y=0 is the QR module bottom edge at the stump.
    static let stumpEdgeOffsetMeters = 0.0
    /// Accept calibration only when temporal corner RMS is at or below this (pixels).
    static let maxTemporalCornerRMSPixels = 2.5
    /// Reject quads that are too skewed to be a near-frontal planar square.
    static let minCornerAngleDegrees = 55.0
    static let maxCornerAngleDegrees = 125.0

    static var inAppProtocolLines: [String] {
        [
            "1. Print the 3×3 A4 board at 100%. Verify the 160 mm ruler on sheet C2.",
            "2. Assemble with overlap marks; place C2 front-middle, clear of the stumps.",
            "3. Middle stump touches the red bottom edge of the 160 mm QR. Arrow down the pitch.",
            "4. Hold still for 15 stable frames. Accept only if RMS ≤ 2.5 px.",
            "5. Remove all nine sheets. Do not move the phone after calibration.",
        ]
    }

    static func groundCornersMeters() -> [CGPoint] {
        let half = targetSideMeters / 2
        let stumpY = stumpEdgeOffsetMeters
        return [
            CGPoint(x: -half, y: stumpY),
            CGPoint(x: half, y: stumpY),
            CGPoint(x: half, y: stumpY + targetSideMeters),
            CGPoint(x: -half, y: stumpY + targetSideMeters),
        ]
    }
}

final class CalibrationBoardDetector {
    static let payload = MetricCalibrationProtocol.payload
    static let targetSideMeters = MetricCalibrationProtocol.targetSideMeters

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

        // Vision corners are the QR symbol (modules), ordered in barcode upright frame.
        // Printed C2 keeps QR upright with stump at the module bottom edge.
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
        guard Self.isPlausibleMetricQuad(observation.cornersPixels) else { return }
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
        guard Self.isPlausibleMetricQuad(corners) else { return nil }

        let ground = MetricCalibrationProtocol.groundCornersMeters()
        let imageToGround = try Homography.solve(source: corners, destination: ground)
        let groundToImage = try Homography.inverse(imageToGround)
        let residual = temporalCornerRMS(observations, median: corners)
        let cameraToWorld = decomposeCameraPose(
            groundToImage: groundToImage,
            intrinsics: cameraIntrinsics
        )
        guard let cameraToWorld else { return nil }
        // Phone is behind the stumps looking at the pitch; expect a sane height.
        guard cameraToWorld.columns.3.z > 0.05, cameraToWorld.columns.3.z < 25 else { return nil }

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

    /// Reject nonsense detections before they enter the median window.
    static func isPlausibleMetricQuad(_ corners: [CGPoint]) -> Bool {
        guard corners.count == 4 else { return false }
        let sides = (0..<4).map { index in
            hypot(
                Double(corners[(index + 1) % 4].x - corners[index].x),
                Double(corners[(index + 1) % 4].y - corners[index].y)
            )
        }
        guard let minSide = sides.min(), let maxSide = sides.max(), minSide > 20 else { return false }
        guard maxSide / minSide <= 1.35 else { return false }

        for index in 0..<4 {
            let prev = corners[(index + 3) % 4]
            let corner = corners[index]
            let next = corners[(index + 1) % 4]
            let v1 = SIMD2(Double(prev.x - corner.x), Double(prev.y - corner.y))
            let v2 = SIMD2(Double(next.x - corner.x), Double(next.y - corner.y))
            let denom = max(simd_length(v1) * simd_length(v2), 1e-9)
            let cosAngle = max(-1.0, min(1.0, simd_dot(v1, v2) / denom))
            let degrees = acos(cosAngle) * 180 / .pi
            if degrees < MetricCalibrationProtocol.minCornerAngleDegrees ||
                degrees > MetricCalibrationProtocol.maxCornerAngleDegrees {
                return false
            }
        }

        var signs = [Double]()
        for index in 0..<4 {
            let a = corners[index]
            let b = corners[(index + 1) % 4]
            let c = corners[(index + 2) % 4]
            let cross =
                (Double(b.x - a.x) * Double(c.y - b.y)) -
                (Double(b.y - a.y) * Double(c.x - b.x))
            signs.append(cross)
        }
        let positive = signs.filter { $0 > 0 }.count
        let negative = signs.filter { $0 < 0 }.count
        return positive == 4 || negative == 4
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
        var r2 = simd_normalize(r2Raw)
        var r3 = simd_normalize(simd_cross(r1, r2))
        if simd_dot(simd_cross(r1, r2), r3) < 0 {
            r2 = -r2
            r3 = -r3
        }
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
