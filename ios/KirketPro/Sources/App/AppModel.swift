import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var stage: KirketStage = .calibrate
    @Published var calibration: CalibrationSolution?
    @Published var latestMeasurement: NativeShotMeasurement?
    @Published var status = "Print and place the Kirket metric target to begin."
    @Published var isBusy = false

    let camera = HighSpeedCameraController()

    var canCapture: Bool {
        calibration?.isMeasurementReady == true
    }

    func acceptCalibration(_ solution: CalibrationSolution) {
        calibration = solution
        status = solution.isMeasurementReady
            ? "Metric calibration accepted. Lock the phone mount before capture."
            : "Calibration residual is too high. Reposition the target and retry."
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
