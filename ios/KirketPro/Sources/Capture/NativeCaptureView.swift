import AVKit
import SwiftUI

struct NativeCaptureView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selectedFPS = 240

    var body: some View {
        VStack(spacing: 12) {
            CameraPreview(session: model.camera.session)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .overlay(alignment: .top) {
                    Text("\(selectedFPS) FPS • 1× camera • focus/exposure locked")
                        .font(.caption.bold())
                        .padding(8)
                        .background(.black.opacity(0.72), in: Capsule())
                        .padding()
                }

            Picker("Capture rate", selection: $selectedFPS) {
                Text("4K/120").tag(120)
                Text("1080p/240").tag(240)
            }
            .pickerStyle(.segmented)
            .disabled(model.camera.isRecording)

            HStack {
                Button("Configure \(selectedFPS) fps") {
                    Task {
                        await model.camera.configureHighSpeed(fps: selectedFPS)
                        model.camera.lockFocusAndExposure()
                    }
                }
                .buttonStyle(.bordered)
                .disabled(model.camera.isRecording || !model.canCapture)

                Button(model.camera.isRecording ? "Stop recording" : "Record delivery") {
                    if model.camera.isRecording {
                        model.camera.stopRecording()
                    } else {
                        model.camera.startRecording()
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(model.camera.isRecording ? .red : .green)
                .disabled(!model.camera.isConfigured || !model.canCapture)
            }

            if let error = model.camera.errorMessage {
                Text(error)
                    .foregroundStyle(.red)
                    .font(.footnote)
            }

            if let url = model.camera.recordedURL {
                VideoPlayer(player: AVPlayer(url: url))
                    .frame(height: 180)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                Button("Review contact and track ball") {
                    model.stage = .review
                }
                .buttonStyle(.borderedProminent)
            }

            Text("Record only a few seconds around one delivery. Original high-speed frames remain on device.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding()
        .task {
            guard model.canCapture else {
                model.status = "Accept a stable metric calibration before capture."
                return
            }
            await model.camera.configureHighSpeed(fps: selectedFPS)
            model.camera.lockFocusAndExposure()
        }
    }
}
