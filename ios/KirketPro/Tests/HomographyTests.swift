import CoreGraphics
import XCTest
@testable import KirketPro

final class HomographyTests: XCTestCase {
    func testRoundTripMetricTarget() throws {
        let image = [
            CGPoint(x: 120, y: 700),
            CGPoint(x: 520, y: 680),
            CGPoint(x: 470, y: 220),
            CGPoint(x: 160, y: 240),
        ]
        let ground = [
            CGPoint(x: -0.08, y: 0),
            CGPoint(x: 0.08, y: 0),
            CGPoint(x: 0.08, y: 0.16),
            CGPoint(x: -0.08, y: 0.16),
        ]
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
}
