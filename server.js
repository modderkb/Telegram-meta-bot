require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_DATASET_ID = process.env.META_DATASET_ID;
const CHANNEL_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

if (!META_ACCESS_TOKEN) {
  console.error("Missing META_ACCESS_TOKEN");
  process.exit(1);
}

if (!META_DATASET_ID) {
  console.error("Missing META_DATASET_ID");
  process.exit(1);
}

if (!CHANNEL_ID) {
  console.error("Missing TELEGRAM_CHAT_ID");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: true
});

// Temporary tracking storage.
// The tracking ID comes from the Telegram /start parameter.
const trackingStore = new Map();


// ===============================
// HOME / HEALTH CHECK
// ===============================

app.get("/", (req, res) => {
  res.status(200).send("Telegram Meta Bot is running ✅");
});


// ===============================
// TELEGRAM /START
// ===============================

bot.onText(/^\/start(?:\s+(.+))?$/, async (msg, match) => {

  const telegramUserId = msg.from.id;
  const privateChatId = msg.chat.id;

  const trackingId = match && match[1]
    ? match[1].trim()
    : "";

  // Save tracking ID against Telegram user
  if (trackingId) {
    trackingStore.set(
      String(telegramUserId),
      trackingId
    );
  }

  const joinLink =
    "https://t.me/+9ebBoLgXJAo0ZDY1";

  try {

    await bot.sendMessage(
      privateChatId,

      "👋 Welcome!\n\n" +
      "Pehle hamara channel join karo.\n" +
      "Join karne ke baad neeche VERIFY JOIN button dabao.",

      {
        reply_markup: {
          inline_keyboard: [

            [
              {
                text: "🚀 JOIN CHANNEL",
                url: joinLink
              }
            ],

            [
              {
                text: "✅ VERIFY JOIN",
                callback_data: "verify_join"
              }
            ]

          ]
        }
      }
    );

  } catch (error) {

    console.error(
      "START ERROR:",
      error.message
    );

  }

});


// ===============================
// VERIFY JOIN
// ===============================

bot.on("callback_query", async (query) => {

  if (query.data !== "verify_join") {
    return;
  }

  const telegramUserId = query.from.id;
  const privateChatId = query.message.chat.id;

  try {

    // Check Telegram channel membership
    const member = await bot.getChatMember(
      CHANNEL_ID,
      telegramUserId
    );

    const validStatuses = [
      "member",
      "administrator",
      "creator"
    ];

    if (!validStatuses.includes(member.status)) {

      await bot.answerCallbackQuery(
        query.id,
        {
          text: "❌ Pehle channel join karo.",
          show_alert: true
        }
      );

      return;
    }


    // Membership confirmed
    await bot.answerCallbackQuery(
      query.id,
      {
        text: "✅ Join verified!"
      }
    );


    await bot.sendMessage(
      privateChatId,

      "🎉 Channel Join Verified!\n\n" +
      "Your join has been recorded successfully."
    );


    // Get tracking ID
    const trackingId =
      trackingStore.get(
        String(telegramUserId)
      ) || "";


    // Send conversion to Meta
    await sendMetaConversion({
      telegramUserId,
      trackingId
    });


    // Prevent duplicate conversion in this running instance
    trackingStore.delete(
      String(telegramUserId)
    );

  } catch (error) {

    console.error(
      "VERIFY ERROR:",
      error.message
    );

    try {

      await bot.answerCallbackQuery(
        query.id,
        {
          text: "⚠️ Verification error. Try again.",
          show_alert: true
        }
      );

    } catch (_) {}

  }

});


// ===============================
// META CONVERSIONS API
// ===============================

async function sendMetaConversion({
  telegramUserId,
  trackingId
}) {

  const eventId =
    crypto.randomUUID();

  const eventTime =
    Math.floor(Date.now() / 1000);


  // Hash Telegram ID before sending as external_id
  const externalId =
    crypto
      .createHash("sha256")
      .update(String(telegramUserId))
      .digest("hex");


  const event = {

    event_name: "TelegramJoin",

    event_time: eventTime,

    event_id: eventId,

    action_source: "other",

    user_data: {
      external_id: [
        externalId
      ]
    }

  };


  // Add tracking information if available
  if (trackingId) {

    event.custom_data = {
      tracking_id: trackingId
    };

  }


  const url =
    `https://graph.facebook.com/v24.0/` +
    `${META_DATASET_ID}/events` +
    `?access_token=${encodeURIComponent(
      META_ACCESS_TOKEN
    )}`;


  const response = await fetch(
    url,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        data: [event]
      })
    }
  );


  const result =
    await response.json();


  console.log(
    "META RESPONSE:",
    JSON.stringify(
      result,
      null,
      2
    )
  );


  if (!response.ok) {

    throw new Error(
      `Meta API Error: ${
        JSON.stringify(result)
      }`
    );

  }


  return result;
}


// ===============================
// TELEGRAM ERROR HANDLERS
// ===============================

bot.on("polling_error", (error) => {

  console.error(
    "Telegram polling error:",
    error.message
  );

});


// ===============================
// START SERVER
// ===============================

app.listen(
  PORT,
  () => {

    console.log(
      `Server running on port ${PORT}`
    );

  }
);
