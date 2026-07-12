import CoreGraphics
import CoreMedia
import Foundation
import simd

struct CalibrationSolution: Sendable {
    let imageToGround: simd_double3x3
    let groundToImage: simd_double3x3
    let cameraIntrinsics: simd_double3x3
    let cameraToWorld: simd_double4x4?
    let reprojectionErrorPixels: Double
    let targetCornersPixels: [CGPoint]
    let targetSizeMeters: CGSize
    let createdAt: Date

    var isMeasurementReady: Bool {
        reprojectionErrorPixels.isFinite &&
        reprojectionErrorPixels <= MetricCalibrationProtocol.maxTemporalCornerRMSPixels &&
        cameraToWorld != nil &&
        abs(simd_determinant(imageToGround)) > 1e-10
    }
}

struct BallObservation: Sendable, Identifiable {
    let id = UUID()
    let presentationTime: CMTime
    let centerPixels: CGPoint
    let radiusPixels: Double
    let confidence: Double
    let source: ObservationSource

    enum ObservationSource: String, Sendable {
        case coreML
        case visionTracker
        case colorMotion
        case manual
    }
}

struct WorldBallSample: Sendable {
    let timeSeconds: Double
    let positionMeters: SIMD3<Double>
    let confidence: Double
}

struct NativeShotMeasurement: Sendable {
    let speedMetersPerSecond: Double
    let directionDegrees: Double
    let launchAngleDegrees: Double
    let impactTime: CMTime
    let fitResidualMeters: Double
    let confidence: Double
    let samples: [WorldBallSample]
    let warnings: [String]

    var isAccepted: Bool {
        samples.count >= 6 &&
        fitResidualMeters <= 0.18 &&
        confidence >= 0.7
    }
}

enum KirketStage: String, CaseIterable, Identifiable {
    case calibrate = "Calibrate"
    case capture = "Capture"
    case review = "Review"

    var id: String { rawValue }
}
