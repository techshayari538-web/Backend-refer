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

// ---------------------------------------------------------------------------
// 🔌 CONFIGURATIONS & FIREBASE INITIALIZATION
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.FIREBASE_APP_ID || ""
};

// NextJS/Vercel serverless containers re-use optimization
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBAPP_URL = "https://techshayari538-web.github.io/Watch-and-Earn/";
const CHANNEL_URL = "https://t.me/WatchNdEarnn";

// ---------------------------------------------------------------------------
// ⚙️ ATOMIC REFERRAL TRANSACTION ENGINE
// ---------------------------------------------------------------------------
async function processReferralReward(userId) {
  const userRef = doc(db, "users", String(userId));
  
  try {
    await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) return;

      const userData = userSnap.data();
      const referrerId = userData.refferBy;

      // STRICT CONDITIONS CHECK
      if (userData.frontendOpened === true && userData.rewardGiven === false && referrerId) {
        const referrerRef = doc(db, "users", String(referrerId));
        const rewardLedgerRef = doc(db, "ref_rewards", String(userId));

        // 1. Credit the Referrer
        transaction.update(referrerRef, {
          coins: increment(500),
          reffer: increment(1)
        });

        // 2. Lock current user to prevent duplicate verification claims
        transaction.update(userRef, {
          rewardGiven: true
        });

        // 3. Document immutable ledger entry
        transaction.set(rewardLedgerRef, {
          userId: String(userId),
          referrerId: String(referrerId),
          reward: 500,
          createdAt: serverTimestamp()
        });
      }
    });
    return true;
  } catch (error) {
    console.error("Referral processing exception caught:", error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 🚀 TELEGRAM OUTBOUND DISPATCHER
// ---------------------------------------------------------------------------
async function sendTelegramMessage(chatId, text, inlineKeyboard) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      reply_markup: { inline_keyboard: inlineKeyboard }
    })
  });
  return response.json();
}

// ---------------------------------------------------------------------------
// 🌐 VERCEL WEBHOOK CONTROLLER
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Method Not Allowed");
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

      // Referral extraction logic (/start ref123)
      const parts = textStr.split(" ");
      let referralId = null;
      if (parts.length > 1) {
        referralId = parts[1].replace("ref", "").trim();
      }

      const userRef = doc(db, "users", String(userId));
      const userSnap = await getDoc(userRef);

      // Create or update status flags using pure modular calls
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

      // Execute referral transaction matrix
      await processReferralReward(userId);

      // UI Message parameters setup
      const welcomeCaption = `👋 Hi! Welcome ${firstName} ⭐\nYaha aap tasks complete karke real rewards kama sakte ho!\n\n🔥 Daily Tasks\n🔥 Video Watch\n🔥 Mini Apps\n🔥 Referral Bonus\n🔥 Auto Wallet System\n\nReady to earn?\nTap START and your journey begins!`;

      const keyboardLayout = [
        [{ text: "▶ Open App", web_app: { url: WEBAPP_URL } }],
        [
          { text: "📢 Channel", url: CHANNEL_URL },
          { text: "🌐 Community", url: CHANNEL_URL }
        ]
      ];

      await sendTelegramMessage(chatId, welcomeCaption, keyboardLayout);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("Top-level execution isolation catch:", err);
    return res.status(200).send("Execution complete with catch fallbacks.");
  }
}
