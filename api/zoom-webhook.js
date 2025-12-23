import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const { event, payload } = req.body;
  console.log("ZOOM EVENT:", event);

  // ======================================================
  // 1. Zoom URL validation (DO NOT TOUCH)
  // ======================================================
  if (event === "endpoint.url_validation") {
    const plainToken = payload.plainToken;
    const encryptedToken = crypto
      .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET)
      .update(plainToken)
      .digest("hex");

    return res.status(200).json({ plainToken, encryptedToken });
  }

  // ======================================================
  // 2. Store RAW webhook (always)
  // ======================================================
  await supabase.from("zoom_webhook_events").insert({
    event_type: event,
    zoom_meeting_id: payload?.object?.id?.toString() ?? null,
    zoom_account_email: payload?.account_id ?? null,
    payload,
  });

  // ======================================================
  // 3. STEP 15 — Participant Join / Leave ONLY
  // ======================================================
  if (
    event === "meeting.participant_joined" ||
    event === "meeting.participant_left"
  ) {
    const obj = payload.object;
    const participant = obj.participant || {};

    // Zoom role (ONLY source of truth here)
    const zoomRole = participant.role || "attendee"; // host | co-host | attendee

    // Normalize role (DO NOT add sales logic here)
    const participantRole =
      zoomRole === "host" || zoomRole === "co-host"
        ? "host"
        : "attendee";

    // IMPORTANT: Zoom event_ts is ALREADY in milliseconds
    const eventTime = new Date(payload.event_ts);

    await supabase.from("zoom_meeting_events").insert({
      meeting_id: obj.id.toString(),
      meeting_uuid: obj.uuid,
      event_type: event,
      participant_name: participant.user_name || null,
      participant_email: participant.email || null,
      participant_role: participantRole,
      join_time:
        event === "meeting.participant_joined" ? eventTime : null,
      leave_time:
        event === "meeting.participant_left" ? eventTime : null,
      payload,
    });

    return res.status(200).json({ status: "participant_event_saved" });
  }

  return res.status(200).json({ status: "ok" });
}
