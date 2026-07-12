# Build Kirket Pro on iPhone and TestFlight

The native app must be built on macOS because Apple camera, Vision, CoreML,
code-signing, and TestFlight tooling are not available on the Linux Cloud Agent.

## Local device build

1. Install current Xcode from the Mac App Store.
2. Install XcodeGen:

   ```bash
   brew install xcodegen
   ```

3. Clone/pull the repository and generate the project:

   ```bash
   cd ios/KirketPro
   xcodegen generate
   open KirketPro.xcodeproj
   ```

4. In Xcode, select the `KirketPro` target → Signing & Capabilities.
5. Select your Apple Development Team.
6. Change `com.kirket.pro` if that bundle identifier is unavailable.
7. Connect the iPhone 16 Pro by USB, trust the Mac, and select it as run
   destination.
8. Build and run.

Run tests in Xcode with **Product → Test**. The generated project includes
`KirketProTests`.

## TestFlight

1. Join the Apple Developer Program.
2. Create the matching App ID in App Store Connect.
3. In Xcode choose **Product → Archive**.
4. In Organizer select **Distribute App → App Store Connect → Upload**.
5. In App Store Connect open TestFlight and add the uploaded build to internal
   testing.
6. Install Apple's TestFlight app on the iPhone and accept the invitation.

## First native measurement test

1. Print the **3×3 A4 board** in `docs/calibration-board-3x3/` at 100% (see that folder’s README). Sheet **C2** has the 160 mm QR on the front-middle (camera side, clear of the stumps).
2. Verify the 160 mm control ruler on **C2** with a physical ruler.
3. Place the assembled board flat so the **red bottom edge of the 160 mm QR on C2** touches the middle stump and the arrow points down the pitch.
4. Calibrate until 15 stable frames are collected and RMS is ≤2.5 px.
5. Remove all nine sheets without moving the phone.
6. Configure 4K/120 or 1080p/240, lock focus/exposure, and record one delivery.
7. Select the exact contact frame.
8. Tap the ball; a custom model is optional until trained.
9. Track and review residual/confidence. Rejected shots must not be treated as
   measurements.

## Custom model

After collecting real clips, follow `ml/README.md`, then drag the exported
`KirketBallDetector.mlmodel` into the Xcode target. The app detects the compiled
model automatically.
