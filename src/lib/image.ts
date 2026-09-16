import { vault } from "./vault";

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function fileExt(file: File): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(file.name);
  return m ? m[1] : file.type.split("/")[1] || "bin";
}

/** 图片（或任意文件）落盘到 vault assets/，返回相对路径（如 assets/a3f8….png） */
export async function uploadFile(file: File): Promise<string> {
  const b64 = await fileToBase64(file);
  return vault.saveAsset(b64, fileExt(file));
}
