export type AiBallDetection = {
  center: { x: number; y: number };
  radiusPx: number;
  confidence: number;
  box: [number, number, number, number];
};

let modelPromise: Promise<any> | undefined;

export async function detectSportsBallWithAi(
  canvas: HTMLCanvasElement,
): Promise<AiBallDetection | undefined> {
  const model = await loadModel();
  const predictions = await model.detect(canvas, 30, 0.12);
  const balls = predictions
    .filter((prediction: any) => prediction.class === "sports ball")
    .sort((a: any, b: any) => b.score - a.score);
  const best = balls[0];
  if (!best) return undefined;
  const [x, y, width, height] = best.bbox as [number, number, number, number];
  return {
    center: { x: x + width / 2, y: y + height / 2 },
    radiusPx: Math.max(3, (width + height) / 4),
    confidence: best.score,
    box: [x, y, width, height],
  };
}

async function loadModel() {
  if (modelPromise) return modelPromise;
  modelPromise = withTimeout(
    (async () => {
      await import("@tensorflow/tfjs");
      const cocoSsd = await import("@tensorflow-models/coco-ssd");
      return cocoSsd.load({ base: "lite_mobilenet_v2" });
    })(),
    45_000,
    "AI model download timed out. Tap the ball manually or retry on a stronger connection.",
  ).catch((error) => {
    modelPromise = undefined;
    throw error;
  });
  return modelPromise;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
