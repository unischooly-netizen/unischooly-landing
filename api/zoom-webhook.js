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

  /* ===============================
     ZOOM URL VALIDATION
  =============================== */
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

  /* ===============================
     PARTICIPANT JOIN / LEAVE
  =============================== */
  if (
    event === "meeting.participant_joined" ||
    event === "meeting.participant_left"
  ) {
    const meetingId = payload.object.id?.toString();
    const meetingUUID = payload.object.uuid;
    const participant = payload.object.participant || {};

    const participantName = participant.user_name || null;
    const participantEmail = participant.email || null;

    let participantRole = "student";

    /* 🔥 INTERNAL ROLE OVERRIDE */
    if (participantEmail) {
      const { data: internalUser } = await supabase
        .from("zoom_internal_users")
        .select("role")
        .eq("email", participantEmail)
        .maybeSingle();

      if (internalUser?.role) {
        participantRole = internalUser.role;
      }
    }

    await supabase.from("zoom_meeting_events").insert({
      meeting_id: meetingId,
      meeting_uuid: meetingUUID,
      event_type: event,
      participant_name: participantName,
      participant_email: participantEmail,
      participant_role: participantRole,
      join_time:
        event === "meeting.participant_joined"
          ? new Date(payload.event_ts)
          : null,
      leave_time:
        event === "meeting.participant_left"
          ? new Date(payload.event_ts)
          : null,
      payload,
    });

    return res.status(200).json({ status: "participant saved" });
  }

  /* ===============================
     STORE ALL RAW EVENTS
  =============================== */
  await supabase.from("zoom_webhook_events").insert({
    event_type: event,
    zoom_meeting_id: payload?.object?.id?.toString() ?? null,
    zoom_account_email: payload?.account_id ?? null,
    payload,
  });

  /* ===============================
     RECORDING COMPLETED
  =============================== */
  if (event === "recording.completed") {
    const meetingId = payload.object.id?.toString();
    const files = payload.object.recording_files || [];

    for (const file of files) {
      await supabase.from("zoom_meeting_events").insert({
        meeting_id: meetingId,
        event_type: "recording.completed",
        participant_name: file.recording_type,
        join_time: file.recording_start,
        leave_time: file.recording_end,
        payload: file,
      });
    }
  }

  return res.status(200).json({ status: "received" });
}
