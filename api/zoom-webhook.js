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

  // 🔐 Zoom URL validation
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

  // 📼 Recording completed event
  if (event === "recording.completed") {
    const meetingId = payload.object.id;
    const hostEmail = payload.object.host_email;
    const recordings = payload.object.recording_files || [];

    for (const file of recordings) {
      await supabase.from("zoom_meeting_events").insert({
        meeting_id: meetingId,
        event_type: "recording.completed",
        participant_name: file.recording_type,
        participant_email: hostEmail,
        join_time: file.recording_start,
        leave_time: file.recording_end,
        payload: file,
      });
    }
  }

  return res.status(200).json({ status: "received" });
}
