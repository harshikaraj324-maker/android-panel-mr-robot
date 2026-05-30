import { useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import type { FormDataRow, MessageRow } from "@/lib/api";

const SUPABASE_URL = "https://dvgcrxrnnezbdjpujjjt.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2Z2NyeHJubmV6YmRqcHVqamp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NjcxNDksImV4cCI6MjA5NTI0MzE0OX0.aHE-dfgEdiNicxfwgTK8w2MZuojyaYr291DnH5vyJmY";

interface AdminStreamCallbacks {
  onMessage?: (row: MessageRow) => void;
  onFormData?: (row: FormDataRow) => void;
}

export function useAdminStream({ onMessage, onFormData }: AdminStreamCallbacks) {
  const callbacksRef = useRef({ onMessage, onFormData });
  callbacksRef.current = { onMessage, onFormData };

  useEffect(() => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 20 } },
    });

    const channel = supabase
      .channel("admin-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          callbacksRef.current.onMessage?.(payload.new as MessageRow);
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "form_data" },
        (payload) => {
          callbacksRef.current.onFormData?.(payload.new as FormDataRow);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}
