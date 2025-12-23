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

  // ===============================
  // Zoom URL validation
  // ===============================
  if (event === "endpoint.url_validation") {
    const plainToken = payload.plainToken;
    const encryptedToken = crypto
      .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET)
      .update(plainToken)
      .digest("hex");

    return res.status(200).json({ plainToken, encryptedToken });
  }

  // ===============================
  // Store raw webhook (always)
  // ===============================
  await supabase.from("zoom_webhook_events").insert({
    event_type: event,
    zoom_meeting_id: payload?.object?.id?.toString() ?? null,
    zoom_account_email: payload?.account_id ?? null,
    payload,
  });

  // ===============================
  // Participant Join / Leave
  // ===============================
  if (
    event === "meeting.participant_joined" ||
    event === "meeting.participant_left"
  ) {
    const obj = payload.object;
    const participant = obj.participant || {};

    const zoomRole = participant.role; // host / co-host / attendee
    const participantRole =
      zoomRole === "host" || zoomRole === "co-host"
        ? "teacher"
        : "student";

    const eventTime = new Date(payload.event_ts / 1000 * 1000);

    await supabase.from("zoom_meeting_events").insert({
      meeting_id: String(obj.id),
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

    return res.status(200).json({ status: "participant saved" });
  }

  // ===============================
  // Recording Completed
  // ===============================
  if (event === "recording.completed") {
    const meetingId = payload.object.id;
    const files = payload.object.recording_files || [];

    for (const file of files) {
      await supabase.from("zoom_meeting_events").insert({
        meeting_id: String(meetingId),
        event_type: "recording.completed",
        participant_name: file.recording_type,
        participant_email: payload.object.host_email,
        join_time: file.recording_start,
        leave_time: file.recording_end,
        payload: file,
      });
    }
  }

  return res.status(200).json({ status: "ok" });
}
