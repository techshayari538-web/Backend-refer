import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc,
  updateDoc,
  runTransaction, 
  serverTimestamp,
  increment 
} from "firebase/firestore";

// 🔌 CONFIGURATIONS & FIREBASE INITIALIZATION
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.FIREBASE_APP_ID || ""
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBAPP_URL = "https://techshayari538-web.github.io/Watch-and-Earn/";
const CHANNEL_URL = "https://t.me/WatchNdEarnn";
const SUPPORT_URL = "https://t.me/WatchNdEarnSupport";

// ⚙️ ATOMIC REFERRAL TRANSACTION ENGINE
async function processReferralReward(userId) {
  const userRef = doc(db, "users", String(userId));
  try {
    await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) return;

      const userData = userSnap.data();
      const referrerId = userData.refferBy;

      if (userData.frontendOpened === true && userData.rewardGiven === false && referrerId) {
        const referrerRef = doc(db, "users", String(referrerId));
        const rewardLedgerRef = doc(db, "ref_rewards", String(userId));

        transaction.update(referrerRef, {
          coins: increment(800),
          reffer: increment(1)
        });

        transaction.update(userRef, {
          rewardGiven: true
        });

        transaction.set(rewardLedgerRef, {
          userId: String(userId),
          referrerId: String(referrerId),
          reward: 800,
          createdAt: serverTimestamp()
        });
      }
    });
    return true;
  } catch (error) {
    console.error("Referral exception:", error);
    return false;
  }
}

// 🚀 TELEGRAM SENDER
async function sendTelegramMessage(chatId, text, inlineKeyboard) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      reply_markup: { inline_keyboard: inlineKeyboard }
    })
  });
}

// 🌐 VERCEL WEBHOOK & CALLBACK CONTROLLER
export default async function handler(req, res) {
  // 1. MONOTAG SECURE CALLBACK BACKEND HANDLER
  if (req.method === "GET" || (req.query && req.query.monotag_callback)) {
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).send("Missing parameter userId");
      }

      const userRef = doc(db, "users", String(userId));
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        return res.status(404).send("User not found in system storage");
      }

      // Ad network validation standard reward increment
      await updateDoc(userRef, {
        coins: increment(50)
      });

      return res.status(200).send("OK_REWARD_CREDITED");
    } catch (cbErr) {
      console.error("Monotag server verification exception:", cbErr);
      return res.status(800).send("Internal processing execution error");
    }
  }

  // 2. TELEGRAM BOT HANDLER (POST REQ)
  if (req.method !== "POST") {
    return res.status(200).send("Method Allowed fallback");
  }

  try {
    const { message } = req.body;
    if (!message || !message.text) {
      return res.status(200).send("No valid payload detected.");
    }

    const chatId = message.chat.id;
    const textStr = message.text.trim();

    if (textStr.startsWith("/start")) {
      const userId = message.from.id;
      const firstName = message.from.first_name || "User";
      const photoURL = message.from.photo_url || "";

      const parts = textStr.split(" ");
      let referralId = null;
      if (parts.length > 1) {
        referralId = parts[1].replace("ref", "").trim();
      }

      const userRef = doc(db, "users", String(userId));
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        const finalReferrer = (referralId && String(referralId) !== String(userId)) ? String(referralId) : null;
        
        await setDoc(userRef, {
          id: String(userId),
          name: firstName,
          photoURL: photoURL,
          coins: 0,
          reffer: 0,
          refferBy: finalReferrer,
          tasksCompleted: 0,
          totalWithdrawals: 0,
          frontendOpened: true,
          rewardGiven: false
        });
      } else {
        await updateDoc(userRef, { frontendOpened: true });
      }

      await processReferralReward(userId);

      const welcomeCaption = `👋 Hi! Welcome ${firstName} ⭐\n\nAapka account successfully create ho gaya hai. Ab aap ghar baithe sirf videos dekhkar acchi earning kar sakte hain.\n\n🔥 Kamane ke tarike:\n\n1️⃣ Watch Videos: Ads aur short videos dekhkar points/cash kamayein.\n2️⃣ Daily Bonus: Rozana free bonus claim karein.\n3️⃣ Refer & Earn: Apne doston ko invite karein aur har refer par extra bonus payein. Upto 800 Coins\n\nReady to earn?\n👇 Niche diye gaye Start Earn button ka use karke earning shuru karein!`;

      const keyboardLayout = [
        [{ text: "▶ Open and Start Earn", web_app: { url: WEBAPP_URL } }],
        [
          { text: "📢 Channel", url: CHANNEL_URL },
          { text: "👨🏻‍💻 Support", url: SUPPORT_URL }
        ]
      ];

      await sendTelegramMessage(chatId, welcomeCaption, keyboardLayout);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("Top-level pipeline crash catch:", err);
    return res.status(200).send("Execution complete safely.");
  }
}