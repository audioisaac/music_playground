// Enumerate audio input/output devices and keep the list fresh.
// Device labels are only populated once mic permission is granted.

import { useEffect, useState } from "react";

export interface DeviceList {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}

export function useDevices(enabled: boolean): DeviceList {
  const [devices, setDevices] = useState<DeviceList>({ inputs: [], outputs: [] });

  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;

    const refresh = async () => {
      const all = await navigator.mediaDevices.enumerateDevices();
      if (cancelled) return;
      setDevices({
        inputs: all.filter((d) => d.kind === "audioinput"),
        outputs: all.filter((d) => d.kind === "audiooutput"),
      });
    };

    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, [enabled]);

  return devices;
}
