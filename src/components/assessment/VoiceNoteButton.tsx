"use client";

import { Mic, MicOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function VoiceNoteButton({ attached, onChange }: { attached: boolean; onChange: (attached: boolean) => void }) {
  const { t } = useTranslation();
  return <Button type="button" variant={attached ? "secondary" : "outline"} onClick={() => onChange(!attached)} aria-pressed={attached}><span className="flex size-5 items-center justify-center rounded-full bg-mint text-primary">{attached ? <Mic aria-hidden="true" className="size-3" /> : <MicOff aria-hidden="true" className="size-3" />}</span>{attached ? t("checkin.voiceAdded") : t("checkin.addVoice")}</Button>;
}
