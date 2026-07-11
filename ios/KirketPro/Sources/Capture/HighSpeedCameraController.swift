@preconcurrency import AVFoundation
import CoreImage
import Foundation
import SwiftUI
import UIKit

final class HighSpeedCameraController: NSObject, ObservableObject, @unchecked Sendable {
    enum Mode: Equatable, Sendable {
        case idle
        case calibration
        case highSpeed(Int)
    }

    @Published private(set) var mode: Mode = .idle
    @Published private(set) var isConfigured = false
    @Published private(set) var isRecording = false
    @Published private(set) var recordedURL: URL?
    @Published private(set) var errorMessage: String?

    let session = AVCaptureSession()
    var calibrationFrameHandler: ((CMSampleBuffer) -> Void)?

    private let sessionQueue = DispatchQueue(label: "com.kirket.camera.session", qos: .userInitiated)
    private let videoOutput = AVCaptureVideoDataOutput()
    private let movieOutput = AVCaptureMovieFileOutput()
    private var cameraInput: AVCaptureDeviceInput?

    @MainActor
    func requestPermissionAndConfigureCalibration() async {
        guard await requestCameraPermission() else {
            errorMessage = "Camera permission is required."
            return
        }
        await configure(mode: .calibration)
    }

    @MainActor
    func configureHighSpeed(fps: Int) async {
        guard await requestCameraPermission() else {
            errorMessage = "Camera permission is required."
            return
        }
        await configure(mode: .highSpeed(fps))
    }

    func startSession() {
        sessionQueue.async { [session] in
            guard !session.isRunning else { return }
            session.startRunning()
        }
    }

    func stopSession() {
        sessionQueue.async { [session] in
            guard session.isRunning else { return }
            session.stopRunning()
        }
    }

    @MainActor
    func startRecording() {
        guard case .highSpeed = mode, isConfigured, !movieOutput.isRecording else {
            errorMessage = "Configure high-speed capture before recording."
            return
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("kirket-\(UUID().uuidString)")
            .appendingPathExtension("mov")
        recordedURL = nil
        movieOutput.startRecording(to: url, recordingDelegate: self)
        isRecording = true
    }

    @MainActor
    func stopRecording() {
        guard movieOutput.isRecording else { return }
        movieOutput.stopRecording()
    }

    func lockFocusAndExposure(devicePoint: CGPoint = CGPoint(x: 0.5, y: 0.5)) {
        sessionQueue.async { [weak self] in
            guard let device = self?.cameraInput?.device else { return }
            do {
                try device.lockForConfiguration()
                if device.isFocusPointOfInterestSupported {
                    device.focusPointOfInterest = devicePoint
                }
                if device.isFocusModeSupported(.locked) {
                    device.focusMode = .locked
                }
                if device.isExposurePointOfInterestSupported {
                    device.exposurePointOfInterest = devicePoint
                }
                if device.isExposureModeSupported(.locked) {
                    device.exposureMode = .locked
                }
                device.isSubjectAreaChangeMonitoringEnabled = false
                device.unlockForConfiguration()
            } catch {
                Task { @MainActor in self?.errorMessage = error.localizedDescription }
            }
        }
    }

    private func requestCameraPermission() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .video)
        default:
            return false
        }
    }

    @MainActor
    private func configure(mode requestedMode: Mode) async {
        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                sessionQueue.async { [weak self] in
                    do {
                        try self?.configureSynchronously(mode: requestedMode)
                        continuation.resume()
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
            mode = requestedMode
            isConfigured = true
            errorMessage = nil
            startSession()
        } catch {
            isConfigured = false
            errorMessage = error.localizedDescription
        }
    }

    private func configureSynchronously(mode: Mode) throws {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.inputs.forEach(session.removeInput)
        session.outputs.forEach(session.removeOutput)

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            throw CameraError.mainCameraUnavailable
        }
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else { throw CameraError.cannotAddInput }
        session.addInput(input)
        cameraInput = input

        switch mode {
        case .calibration:
            session.sessionPreset = .hd1920x1080
            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
            ]
            videoOutput.setSampleBufferDelegate(self, queue: sessionQueue)
            guard session.canAddOutput(videoOutput) else { throw CameraError.cannotAddOutput }
            session.addOutput(videoOutput)
            if let connection = videoOutput.connection(with: .video),
               connection.isCameraIntrinsicMatrixDeliverySupported {
                connection.isCameraIntrinsicMatrixDeliveryEnabled = true
            }

        case .highSpeed(let fps):
            let format = try selectFormat(device: device, requestedFPS: fps)
            try device.lockForConfiguration()
            device.activeFormat = format
            let duration = CMTime(value: 1, timescale: CMTimeScale(fps))
            device.activeVideoMinFrameDuration = duration
            device.activeVideoMaxFrameDuration = duration
            if device.isSmoothAutoFocusSupported {
                device.isSmoothAutoFocusEnabled = false
            }
            device.unlockForConfiguration()
            guard session.canAddOutput(movieOutput) else { throw CameraError.cannotAddOutput }
            session.addOutput(movieOutput)

        case .idle:
            break
        }
    }

    private func selectFormat(
        device: AVCaptureDevice,
        requestedFPS: Int
    ) throws -> AVCaptureDevice.Format {
        let candidates = device.formats.compactMap { format -> (AVCaptureDevice.Format, Int32, Int32)? in
            guard format.videoSupportedFrameRateRanges.contains(where: { $0.maxFrameRate >= Double(requestedFPS) }) else {
                return nil
            }
            let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            return (format, dimensions.width, dimensions.height)
        }
        guard let best = candidates.max(by: { lhs, rhs in
            let lhsArea = Int64(lhs.1) * Int64(lhs.2)
            let rhsArea = Int64(rhs.1) * Int64(rhs.2)
            return lhsArea < rhsArea
        })?.0 else {
            throw CameraError.frameRateUnavailable(requestedFPS)
        }
        return best
    }
}

extension HighSpeedCameraController: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        calibrationFrameHandler?(sampleBuffer)
    }
}

extension HighSpeedCameraController: AVCaptureFileOutputRecordingDelegate {
    func fileOutput(
        _ output: AVCaptureFileOutput,
        didFinishRecordingTo outputFileURL: URL,
        from connections: [AVCaptureConnection],
        error: Error?
    ) {
        Task { @MainActor in
            isRecording = false
            if let error {
                errorMessage = error.localizedDescription
                try? FileManager.default.removeItem(at: outputFileURL)
            } else {
                recordedURL = outputFileURL
            }
        }
    }
}

enum CameraError: LocalizedError {
    case mainCameraUnavailable
    case cannotAddInput
    case cannotAddOutput
    case frameRateUnavailable(Int)

    var errorDescription: String? {
        switch self {
        case .mainCameraUnavailable:
            "The rear 1× camera is unavailable."
        case .cannotAddInput:
            "The camera input could not be added."
        case .cannotAddOutput:
            "The requested camera output could not be added."
        case .frameRateUnavailable(let fps):
            "This camera does not expose a \(fps) fps format."
        }
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {
        uiView.previewLayer.session = session
    }
}

final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}
