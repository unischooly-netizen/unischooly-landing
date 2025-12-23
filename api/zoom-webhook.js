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

  const { event, payload } = req.body || {};

  // ✅ Zoom URL validation (KEEP THIS)
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

  // ✅ STORE ALL EVENTS IN SUPABASE
  try {
    const meetingId =
      payload?.object?.id ||
      payload?.object?.meeting_id ||
      null;

    const accountEmail =
      payload?.account_id || null;

    const { error } = await supabase
      .from("zoom_webhook_events")
      .insert({
        event_type: event,
        zoom_meeting_id: meetingId,
        zoom_account_email: accountEmail,
        payload,
      });

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "DB insert failed" });
    }

    return res.status(200).json({ status: "stored" });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: "Webhook failed" });
  }
}
