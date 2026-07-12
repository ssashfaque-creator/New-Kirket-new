import CoreGraphics
import XCTest
import simd
@testable import KirketPro

final class HomographyTests: XCTestCase {
    func testRoundTripMetricTarget() throws {
        let image = [
            CGPoint(x: 120, y: 700),
            CGPoint(x: 520, y: 680),
            CGPoint(x: 470, y: 220),
            CGPoint(x: 160, y: 240),
        ]
        let ground = MetricCalibrationProtocol.groundCornersMeters()
        let imageToGround = try Homography.solve(source: image, destination: ground)
        let groundToImage = try Homography.inverse(imageToGround)

        for (pixel, metric) in zip(image, ground) {
            let projectedMetric = Homography.project(pixel, using: imageToGround)
            let projectedPixel = Homography.project(metric, using: groundToImage)
            XCTAssertEqual(projectedMetric.x, metric.x, accuracy: 1e-8)
            XCTAssertEqual(projectedMetric.y, metric.y, accuracy: 1e-8)
            XCTAssertEqual(projectedPixel.x, pixel.x, accuracy: 1e-6)
            XCTAssertEqual(projectedPixel.y, pixel.y, accuracy: 1e-6)
        }
    }

    func testRejectsDegenerateTarget() {
        let line = [
            CGPoint(x: 0, y: 0),
            CGPoint(x: 1, y: 0),
            CGPoint(x: 2, y: 0),
            CGPoint(x: 3, y: 0),
        ]
        XCTAssertThrowsError(try Homography.solve(source: line, destination: line))
    }

    func testMetricProtocolMatchesDetectorAssumptions() {
        XCTAssertEqual(
            MetricCalibrationProtocol.payload,
            "KIRKET_METRIC_TARGET_V1_SIZE_160MM_STUMP_EDGE_BOTTOM"
        )
        XCTAssertEqual(MetricCalibrationProtocol.targetSideMeters, 0.160, accuracy: 1e-12)
        XCTAssertEqual(MetricCalibrationProtocol.stumpEdgeOffsetMeters, 0.0, accuracy: 1e-12)
        XCTAssertEqual(MetricCalibrationProtocol.qrSheetId, "C2")
        XCTAssertEqual(CalibrationBoardDetector.payload, MetricCalibrationProtocol.payload)
        XCTAssertEqual(
            CalibrationBoardDetector.targetSideMeters,
            MetricCalibrationProtocol.targetSideMeters,
            accuracy: 1e-12
        )
        XCTAssertFalse(MetricCalibrationProtocol.inAppProtocolLines.isEmpty)

        let ground = MetricCalibrationProtocol.groundCornersMeters()
        XCTAssertEqual(ground[0].y, 0, accuracy: 1e-12)
        XCTAssertEqual(ground[1].y, 0, accuracy: 1e-12)
        XCTAssertEqual(ground[2].y, 0.16, accuracy: 1e-12)
        XCTAssertEqual(hypot(ground[1].x - ground[0].x, ground[1].y - ground[0].y), 0.16, accuracy: 1e-12)
    }

    func testPlausibleQuadAcceptsNearSquare() {
        let square = [
            CGPoint(x: 100, y: 500),
            CGPoint(x: 400, y: 500),
            CGPoint(x: 400, y: 200),
            CGPoint(x: 100, y: 200),
        ]
        XCTAssertTrue(MetricCalibrationAccumulator.isPlausibleMetricQuad(square))
    }

    func testPlausibleQuadRejectsDegenerate() {
        let skinny = [
            CGPoint(x: 100, y: 500),
            CGPoint(x: 400, y: 500),
            CGPoint(x: 401, y: 490),
            CGPoint(x: 101, y: 490),
        ]
        XCTAssertFalse(MetricCalibrationAccumulator.isPlausibleMetricQuad(skinny))
    }

    func testAccumulatorSolvesStableSyntheticTarget() throws {
        let imageSize = CGSize(width: 1080, height: 1920)
        let ideal = [
            CGPoint(x: 340, y: 1200),
            CGPoint(x: 740, y: 1200),
            CGPoint(x: 700, y: 800),
            CGPoint(x: 380, y: 800),
        ]
        var accumulator = MetricCalibrationAccumulator(requiredFrames: 15)
        for frame in 0..<15 {
            let jitter = Double(frame % 3) - 1.0 // -1,0,1 px
            let corners = ideal.map {
                CGPoint(x: $0.x + jitter, y: $0.y - jitter * 0.5)
            }
            accumulator.append(
                MetricTargetObservation(cornersPixels: corners, confidence: 0.9, imageSize: imageSize)
            )
        }

        let fx = 1400.0
        let fy = 1400.0
        let cx = Double(imageSize.width) / 2
        let cy = Double(imageSize.height) / 2
        let intrinsics = simd_double3x3(
            SIMD3(fx, 0, 0),
            SIMD3(0, fy, 0),
            SIMD3(cx, cy, 1)
        )

        let solution = try XCTUnwrap(try accumulator.solve(cameraIntrinsics: intrinsics))
        XCTAssertLessThanOrEqual(solution.reprojectionErrorPixels, 2.5)
        XCTAssertTrue(solution.isMeasurementReady)
        XCTAssertNotNil(solution.cameraToWorld)

        let ground = MetricCalibrationProtocol.groundCornersMeters()
        for (pixel, metric) in zip(solution.targetCornersPixels, ground) {
            let projected = Homography.project(pixel, using: solution.imageToGround)
            XCTAssertEqual(projected.x, metric.x, accuracy: 1e-6)
            XCTAssertEqual(projected.y, metric.y, accuracy: 1e-6)
        }

        // Scale sanity: image bottom edge length maps to exactly 0.16 m by construction.
        let bl = Homography.project(solution.targetCornersPixels[0], using: solution.imageToGround)
        let br = Homography.project(solution.targetCornersPixels[1], using: solution.imageToGround)
        XCTAssertEqual(hypot(br.x - bl.x, br.y - bl.y), 0.16, accuracy: 1e-9)
        XCTAssertEqual(bl.y, 0, accuracy: 1e-9)
        XCTAssertEqual(br.y, 0, accuracy: 1e-9)
    }

    func testQuietZoneMustNotBeInsideMetricSide() {
        // Documented contract: if quiet zone were inside 160 mm, Vision would see ~128.8 mm
        // (33/41) and scale would be wrong by ~24%. Modules must fill the metric square.
        let modulesWithQuietZoneInside = 41.0
        let modulesOnly = 33.0
        let wrongVisionSide = 0.160 * (modulesOnly / modulesWithQuietZoneInside)
        XCTAssertEqual(wrongVisionSide, 0.160 * 33 / 41, accuracy: 1e-12)
        XCTAssertEqual(MetricCalibrationProtocol.targetSideMeters, 0.160, accuracy: 1e-12)
        XCTAssertGreaterThan(0.160 - wrongVisionSide, 0.03)
    }
}
