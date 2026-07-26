"use client";

import { useEffect, useRef } from "react";
import { ensureInviteAfterPublicSign } from "@/app/actions/signature-public";

/** Rattrape l’e-mail du signataire suivant si l’envoi a été coupé. */
export function EnsureNextInvite({ token }: { token: string }) {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    ensureInviteAfterPublicSign(token).catch((e) => {
      console.error("[EnsureNextInvite]", e);
    });
  }, [token]);

  return null;
}
