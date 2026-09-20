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

/*
  Telegram user ID -> tracking ID
*/
const trackingStore = new Map();

/*
  Tracking ID -> Meta click information
*/
const clickStore = new Map();

const TRACKING_TTL = 24 * 60 * 60 * 1000;


/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.status(200).send("Telegram Meta Bot is running ✅");
});


/* =========================
   TRACKING LINK
========================= */

app.get("/track", (req, res) => {
  try {

    const fbclid =
      typeof req.query.fbclid === "string"
        ? req.query.fbclid.slice(0, 300)
        : "";

    const fbp =
      typeof req.query.fbp === "string"
        ? req.query.fbp.slice(0, 300)
        : "";

    const trackingId =
      crypto.randomBytes(8).toString("hex");

    clickStore.set(trackingId, {
      fbclid,
      fbp,
      clickTime: Date.now()
    });

    console.log("NEW CLICK:", {
      trackingId,
      hasFbclid: Boolean(fbclid),
      hasFbp: Boolean(fbp)
    });

    const telegramUrl =
      `https://t.me/Memberxtrader_bot?start=${trackingId}`;

    res.redirect(302, telegramUrl);

  } catch (error) {

    console.error(
      "TRACK ERROR:",
      error.message
    );

    res.status(500).send(
      "Tracking error"
    );
  }
});


/* =========================
   CLEAN OLD TRACKING DATA
========================= */

setInterval(() => {

  const now = Date.now();

  for (const [
    trackingId,
    data
  ] of clickStore.entries()) {

    if (
      now - data.clickTime >
      TRACKING_TTL
    ) {
      clickStore.delete(trackingId);
    }
  }

}, 60 * 60 * 1000);


/* =========================
   /START
========================= */

bot.onText(
  /^\/start(?:\s+(.+))?$/,
  async (msg, match) => {

    const telegramUserId =
      msg.from.id;

    const privateChatId =
      msg.chat.id;

    const trackingId =
      match && match[1]
        ? match[1].trim()
        : "";

    if (trackingId) {

      trackingStore.set(
        String(telegramUserId),
        trackingId
      );

      console.log(
        "TRACKING SAVED:",
        telegramUserId,
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
  }
);


/* =========================
   VERIFY JOIN
========================= */

bot.on(
  "callback_query",
  async (query) => {

    if (
      query.data !== "verify_join"
    ) {
      return;
    }

    const telegramUserId =
      query.from.id;

    const privateChatId =
      query.message.chat.id;

    try {

      const member =
        await bot.getChatMember(
          CHANNEL_ID,
          telegramUserId
        );

      const validStatuses = [
        "member",
        "administrator",
        "creator"
      ];

      if (
        !validStatuses.includes(
          member.status
        )
      ) {

        await bot.answerCallbackQuery(
          query.id,
          {
            text:
              "❌ Pehle channel join karo.",
            show_alert: true
          }
        );

        return;
      }


      await bot.answerCallbackQuery(
        query.id,
        {
          text:
            "✅ Join verified!"
        }
      );


      await bot.sendMessage(
        privateChatId,

        "🎉 Channel Join Verified!\n\n" +
        "Your join has been recorded successfully."
      );


      const trackingId =
        trackingStore.get(
          String(telegramUserId)
        ) || "";


      const clickData =
        trackingId
          ? clickStore.get(trackingId)
          : null;


      console.log(
        "VERIFIED:",
        {
          telegramUserId,
          trackingId,
          hasClickData: Boolean(clickData)
        }
      );


      await sendMetaConversion({

        telegramUserId,

        trackingId,

        clickData
      });


      trackingStore.delete(
        String(telegramUserId)
      );


      if (trackingId) {

        clickStore.delete(
          trackingId
        );
      }

    } catch (error) {

      console.error(
        "VERIFY ERROR:",
        error.message
      );

      try {

        await bot.answerCallbackQuery(
          query.id,
          {
            text:
              "⚠️ Verification error. Try again.",
            show_alert: true
          }
        );

      } catch (_) {}
    }
  }
);


/* =========================
   META CONVERSION API
========================= */

async function sendMetaConversion({

  telegramUserId,

  trackingId,

  clickData

}) {

  const eventId =
    crypto.randomUUID();

  const eventTime =
    Math.floor(
      Date.now() / 1000
    );


  /*
    Hash Telegram user ID
    for external_id
  */

  const externalId =
    crypto
      .createHash("sha256")
      .update(
        String(telegramUserId)
      )
      .digest("hex");


  const userData = {

    external_id: [
      externalId
    ]

  };


  /*
    Add _fbp if available
  */

  if (
    clickData &&
    clickData.fbp
  ) {

    userData.fbp =
      clickData.fbp;
  }


  /*
    Convert fbclid into fbc
  */

  if (
    clickData &&
    clickData.fbclid
  ) {

    userData.fbc =
      `fb.1.${clickData.clickTime}.${clickData.fbclid}`;
  }


  const event = {

    event_name:
      "TelegramJoin",

    event_time:
      eventTime,

    event_id:
      eventId,

    action_source:
      "other",

    user_data:
      userData
  };


  /*
    Save tracking ID as custom data
  */

  if (trackingId) {

    event.custom_data = {

      tracking_id:
        trackingId

    };
  }


  const url =
    `https://graph.facebook.com/v24.0/` +
    `${META_DATASET_ID}/events` +
    `?access_token=` +
    encodeURIComponent(
      META_ACCESS_TOKEN
    );


  console.log(
    "SENDING META EVENT:",
    JSON.stringify(
      {
        event_name:
          event.event_name,

        hasFbc:
          Boolean(userData.fbc),

        hasFbp:
          Boolean(userData.fbp),

        hasExternalId:
          Boolean(userData.external_id)
      },
      null,
      2
    )
  );


  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          data: [
            event
          ]
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
      `Meta API Error: ${JSON.stringify(result)}`
    );
  }


  return result;
}


/* =========================
   TELEGRAM POLLING ERROR
========================= */

bot.on(
  "polling_error",
  (error) => {

    console.error(
      "Telegram polling error:",
      error.message
    );
  }
);


/* =========================
   SERVER
========================= */

app.listen(
  PORT,
  () => {

    console.log(
      `Server running on port ${PORT}`
    );

  }
);
