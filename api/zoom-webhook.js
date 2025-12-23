import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Resolve participant role using:
 * 1. Email match (if available)
 * 2. Display name match (fallback)
 * Default → student
 */
async function resolveInternalRole(email, displayName) {
  if (email) {
    const { data } = await supabase
      .from("zoom_internal_users")
      .select("role")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    if (data?.role) return data.role;
  }

  if (displayName) {
    const { data } = await supabase
      .from("zoom_internal_users")
      .select("role")
      .ilike("display_name", displayName)
      .maybeSingle();

    if (data?.role) return data.role;
  }

  return "student";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const { event, payload } = req.body;

  console.log("ZOOM EVENT:", event);

  // ======================================================
  // STEP 1: Zoom Webhook URL Validation
  // ======================================================
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

  // ======================================================
  // STEP 2: Store ALL RAW Zoom Events (Audit Log)
  // ======================================================
  await supabase.from("zoom_webhook_events").insert({
    event_type: event,
    zoom_meeting_id: payload?.object?.id
      ? String(payload.object.id)
      : null,
    zoom_account_email: payload?.account_id ?? null,
    payload,
  });

  // ======================================================
  // STEP 3: Participant Join / Leave Tracking
  // ======================================================
  if (
    event === "meeting.participant_joined" ||
    event === "meeting.participant_left"
  ) {
    const meetingId = payload.object.id;
    const meetingUUID = payload.object.uuid;

    const participant = payload.object.participant || {};

    const participantName = participant.user_name || null;
    const participantEmail = participant.email || null;

    const participantRole = await resolveInternalRole(
      participantEmail,
      participantName
    );

    await supabase.from("zoom_meeting_events").insert({
      meeting_id: String(meetingId),
      meeting_uuid: meetingUUID,
      event_type: event,
      participant_name: participantName,
      participant_email: participantEmail,
      participant_role: participantRole,
      join_time:
        event === "meeting.participant_joined" && participant.join_time
          ? new Date(participant.join_time)
          : null,
      leave_time:
        event === "meeting.participant_left" && participant.leave_time
          ? new Date(participant.leave_time)
          : null,
      payload,
    });

    return res.status(200).json({
      status: "participant event saved",
    });
  }

  // ======================================================
  // STEP 4: Recording Completed (Links come here)
  // ======================================================
  if (event === "recording.completed") {
    const meetingId = payload.object.id;
    const hostEmail = payload.object.host_email;
    const recordings = payload.object.recording_files || [];

    for (const file of recordings) {
      await supabase.from("zoom_meeting_events").insert({
        meeting_id: String(meetingId),
        event_type: "recording.completed",
        participant_name: file.recording_type,
        participant_email: hostEmail,
        join_time: file.recording_start
          ? new Date(file.recording_start)
          : null,
        leave_time: file.recording_end
          ? new Date(file.recording_end)
          : null,
        payload: file, // ⬅ contains download_url + play_url
      });
    }
  }

  return res.status(200).json({ status: "received" });
}
