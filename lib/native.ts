"use client";

/**
 * Native bridge helpers for when the web app runs inside the Capacitor iOS
 * shell (see the ios-native/ folder).
 *
 * We talk to Capacitor through the runtime-injected `window.Capacitor` bridge
 * instead of importing the @capacitor/* npm packages. That keeps the web build
 * dependency-free and guarantees the browser experience is unchanged: in a
 * normal browser `window.Capacitor` is undefined, every function here no-ops,
 * and the existing web file-input / web flows run exactly as before.
 *
 * The native plugins themselves (Camera, PushNotifications) are bundled into
 * the iOS app via ios-native/package.json and exposed on the bridge at runtime.
 */

type Bridge = {
  isNativePlatform: () => boolean;
  Plugins: Record<string, any>;
};

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const c = (window as unknown as { Capacitor?: Bridge }).Capacitor;
  return c && typeof c.isNativePlatform === "function" ? c : null;
}

/** True only when running inside the native iOS (or Android) app shell. */
export function isNativeApp(): boolean {
  const c = bridge();
  return !!c && c.isNativePlatform();
}

async function uriToFile(path: string, format?: string, idx = 0): Promise<File | null> {
  try {
    const blob = await (await fetch(path)).blob();
    const type = blob.type || (format ? `image/${format}` : "image/jpeg");
    const ext = format || type.split("/")[1] || "jpg";
    return new File([blob], `photo-${Date.now()}-${idx}.${ext}`, { type });
  } catch {
    return null;
  }
}

/**
 * Open the native photo library (multi-select) and return the chosen images as
 * File objects, ready to drop into a FormData upload. Returns [] on web or if
 * the user cancels.
 */
export async function pickNativeImages(): Promise<File[]> {
  const c = bridge();
  const Camera = c?.Plugins?.Camera;
  if (!Camera) return [];
  try {
    const res = await Camera.pickImages({ quality: 90 });
    const photos: Array<{ webPath?: string; path?: string; format?: string }> =
      res?.photos ?? [];
    const files: File[] = [];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      const src = p.webPath || p.path;
      if (!src) continue;
      const f = await uriToFile(src, p.format, i);
      if (f) files.push(f);
    }
    return files;
  } catch {
    return [];
  }
}

/**
 * Open the native camera and return a single captured photo as a File. Returns
 * null on web or if the user cancels.
 */
export async function takeNativePhoto(): Promise<File | null> {
  const c = bridge();
  const Camera = c?.Plugins?.Camera;
  if (!Camera) return null;
  try {
    const photo = await Camera.getPhoto({
      quality: 90,
      resultType: "uri",
      source: "CAMERA",
    });
    const src = photo?.webPath || photo?.path;
    if (!src) return null;
    return uriToFile(src, photo?.format);
  } catch {
    return null;
  }
}

/**
 * Ask for push permission and register with APNs. Resolves to the device token
 * string (to store server-side and target reminders), or null if unavailable /
 * denied. NOTE: sending pushes additionally requires an APNs auth key created
 * in the Apple Developer account once it's active — see ios-native/README.md.
 */
export async function registerForPush(): Promise<string | null> {
  const c = bridge();
  const Push = c?.Plugins?.PushNotifications;
  if (!Push) return null;
  try {
    const perm = await Push.requestPermissions();
    if (perm?.receive !== "granted") return null;
    return await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 10_000);
      Push.addListener("registration", (t: { value: string }) => {
        clearTimeout(timeout);
        resolve(t?.value ?? null);
      });
      Push.addListener("registrationError", () => {
        clearTimeout(timeout);
        resolve(null);
      });
      Push.register();
    });
  } catch {
    return null;
  }
}
