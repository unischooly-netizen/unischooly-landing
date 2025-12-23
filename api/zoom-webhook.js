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

  const eventType = req.body?.event;
  const payload = req.body?.payload;
  const meeting = payload?.object;

  // 1️⃣ Zoom URL validation
  if (eventType === "endpoint.url_validation") {
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

  // 2️⃣ Extract Zoom meeting ID
  const zoomMeetingId = meeting?.id?.toString() || null;
  const hostEmail = meeting?.host_email || null;

  // 3️⃣ Save raw webhook (already working, but now explicit)
  await supabase.from("zoom_webhook_events").insert({
    event_type: eventType,
    zoom_meeting_id: zoomMeetingId,
    zoom_account_email: hostEmail,
    payload: req.body,
  });

  // 4️⃣ Try linking to demo_zoom_meetings
  if (zoomMeetingId) {
    const { data: demoMeeting } = await supabase
      .from("demo_zoom_meetings")
      .select("id, demo_lead_id, teacher_id")
      .eq("zoom_meeting_id", zoomMeetingId)
      .maybeSingle();

    if (demoMeeting) {
      console.log("Linked Zoom event to demo:", demoMeeting.id);
    }
  }

  return res.status(200).json({ status: "received" });
}
