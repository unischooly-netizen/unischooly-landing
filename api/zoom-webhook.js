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
  console.log("ZOOM EVENT RECEIVED:", event);

  // ======================================
  // STEP 0 — Zoom Webhook URL Validation
  // ======================================
  if (event === "endpoint.url_validation") {
    const plainToken = payload.plainToken;
    const encryptedToken = crypto
      .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET)
      .update(plainToken)
      .digest("hex");

    return res.status(200).json({
      plainToken,
      encryptedToken,
    });
  }

  // ======================================
  // STEP 15 — Participant Join / Leave
  // ======================================
  if (
    event === "meeting.participant_joined" ||
    event === "meeting.participant_left"
  ) {
    const meetingId = payload.object.id;
    const meetingUUID = payload.object.uuid;

    const participant = payload.object.participant || {};

    const participantName = participant.user_name || null;
    const participantEmail = participant.email || null;
    const zoomRole = participant.role || null;

    // REAL join / leave times from Zoom
    const joinTime = participant.join_time
      ? new Date(participant.join_time)
      : null;

    const leaveTime = participant.leave_time
      ? new Date(participant.leave_time)
      : null;

    // =========================
    // ROLE MAPPING (FINAL)
    // =========================
    let participantRole = "student";

    // Teacher rules
    if (
      zoomRole === "host" ||
      zoomRole === "co-host" ||
      participantEmail === "info@unischooly.com"
    ) {
      participantRole = "teacher";
    }
    // Sales / internal team
    else if (
      participantEmail &&
      participantEmail.endsWith("@unischooly.com")
    ) {
      participantRole = "sales";
    }

    await supabase.from("zoom_meeting_events").insert({
      meeting_id: String(meetingId),
      meeting_uuid: meetingUUID,
      event_type: event,
      participant_name: participantName,
      participant_email: participantEmail,
      participant_role: participantRole,
      join_time: event === "meeting.participant_joined" ? joinTime : null,
      leave_time: event === "meeting.participant_left" ? leaveTime : null,
      payload,
    });

    return res.status(200).json({ status: "participant event saved" });
  }

  // ======================================
  // STEP 14 — Store ALL Raw Zoom Events
  // ======================================
  await supabase.from("zoom_webhook_events").insert({
    event_type: event,
    zoom_meeting_id: payload?.object?.id?.toString() ?? null,
    zoom_account_email: payload?.account_id ?? null,
    payload,
  });

  // ======================================
  // STEP 18 — Recording Stopped (Files)
  // ======================================
  if (event === "recording.stopped") {
    const meetingId = payload.object.id;
    const hostEmail = payload.object.host_email;
    const recordings = payload?.object?.recording_files ?? [];

    for (const file of recordings) {
      await supabase.from("zoom_meeting_events").insert({
        meeting_id: String(meetingId),
        event_type: "recording.stopped",
        participant_name: file.recording_type,
        participant_email: hostEmail,
        participant_role: "teacher",
        join_time: file.recording_start
          ? new Date(file.recording_start)
          : null,
        leave_time: file.recording_end
          ? new Date(file.recording_end)
          : null,
        payload: file,
      });
    }
  }

  return res.status(200).json({ status: "received" });
}
