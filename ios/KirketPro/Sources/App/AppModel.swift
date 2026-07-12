import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var stage: KirketStage = .calibrate
    @Published var calibration: CalibrationSolution?
    @Published var latestMeasurement: NativeShotMeasurement?
    @Published var status = "Print the 3×3 A4 board, place C2 QR at the middle stump, then calibrate."
    @Published var isBusy = false

    let camera = HighSpeedCameraController()

    var canCapture: Bool {
        calibration?.isMeasurementReady == true
    }

    func acceptCalibration(_ solution: CalibrationSolution) {
        calibration = solution
        status = solution.isMeasurementReady
            ? "Metric calibration accepted. Remove all nine sheets, lock the phone mount, then capture."
            : "Calibration residual is too high. Reposition the C2 QR and retry."
        if solution.isMeasurementReady {
            stage = .capture
        }
    }

    func acceptMeasurement(_ measurement: NativeShotMeasurement) {
        latestMeasurement = measurement
        status = measurement.isAccepted
            ? "Shot measurement accepted."
            : "Shot fit did not pass professional confidence gates."
        stage = .review
    }
}
