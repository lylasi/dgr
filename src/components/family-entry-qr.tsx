"use client";

import { QRCodeSVG } from "qrcode.react";

export function FamilyEntryQr({ url, familyName }: { url: string; familyName: string }) {
  return (
    <div className="mt-3 flex flex-col items-center rounded-2xl bg-white p-4 text-center shadow-sm">
      <QRCodeSVG
        value={url}
        size={176}
        level="M"
        marginSize={2}
        bgColor="#ffffff"
        fgColor="#29304a"
        title={`${familyName}入口二维码`}
      />
      <p className="mt-3 text-sm font-black text-slate-800">扫码打开 {familyName}</p>
      <p className="mt-1 text-xs font-semibold text-slate-500">二维码只包含家庭入口链接，进入具体角色仍需 PIN 或老板账号。</p>
    </div>
  );
}
