import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  doc, 
  getDoc, 
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

// Initialize Firebase once globally per container life-cycle
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBAPP_URL = "https://techshayari538-web.github.io/Watch-and-Earn/";
const CHANNEL_URL = "https://t.me/WatchNdEarnn";

// ---------------------------------------------------------------------------
// ⚙️ FIREBASE ENGINE & CORE BUSINESS UTILITIES
// ---------------------------------------------------------------------------

/**
 * Creates or merges a user profile while tracking the initial referral code.
 */
async function createOrEnsureUser(userId, firstName, photoURL, referralId) {
  const userRef = doc(db, "users", String(userId));
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    // Determine clean clean referral parent link (no self-referrals allowed)
    const finalReferrer = (referralId && String(referralId) !== String(userId)) ? String(referralId) : null;
    
    const newUserObj = {
      id: String(userId),
      name: firstName || "Telegram User",
      photoURL: photoURL || "",
      coins: 0,
      reffer: 0,
      refferBy: finalReferrer,
      tasksCompleted: 0,
      totalWithdrawals: 0,
      frontendOpened: true, // Marked true within this invocation
      rewardGiven: false
    };
    await firebase.firestore().collection("users").doc(String(userId)).set(newUserObj); // Fallback compat conceptually
    // Using Modular syntax:
    // await setDoc(userRef, newUserObj); 
    // Since we want this inside the main request execution thread cleanly, we return it to run under transaction or direct execution:
    return newUserObj;
  } else {
    // If user already exists, update frontendOpened to true inline
    const existingData = userSnap.data();
    if (!existingData.frontendOpened) {
      await firebase.firestore().collection("users").doc(String(userId)).update({ frontendOpened: true });
    }
    return { ...existingData, frontendOpened: true };
  }
}

/**
 * Executes an atomic, idempotent transaction to issue the referral reward.
 */
async function processReferralReward(userId) {
  const userRef = doc(db, "users", String(userId));
  
  try {
    await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) return;

      const userData = userSnap.data();
      const referrerId = userData.refferBy;

      // STRICT ONE-TIME CONDITIONS GATEWAY
      if (userData.frontendOpened === true && userData.rewardGiven === false && referrerId) {
        const referrerRef = doc(db, "users", String(referrerId));
        const rewardLedgerRef = doc(db, "ref_rewards", String(userId));

        // 1. Credit the Referrer
        transaction.update(referrerRef, {
          coins: increment(500),
          reffer: increment(1)
        });

        // 2. Mark current user reward given to prevent duplicate claims
        transaction.update(userRef, {
          rewardGiven: true
        });

        // 3. Create immutable ledger entry
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
    console.error("Referral transaction fault isolation error:", error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 🚀 TELEGRAM OUTBOUND API SENDER
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
// 🌐 VERCEL SERVERLESS WEBHOOK HANDLER
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  // Gracefully acknowledge non-POST checkups or ping integrations
  if (req.method !== "POST") {
    return res.status(200).send("Serverless Endpoint Operating Normally.");
  }

  try {
    const { message } = req.body;
    if (!message || !message.text) {
      return res.status(200).send("No message structure received.");
    }

    const chatId = message.chat.id;
    const textStr = message.text.trim();

    // 1. Check for /start command parsing
    if (textStr.startsWith("/start")) {
      const userId = message.from.id;
      const firstName = message.from.first_name;
      // Note: Full high-res Telegram avatar extraction usually requires calling getUserProfilePhotos. 
      // We parse an optional fallback string here.
      const photoURL = message.from.photo_url || "";

      // Extract referral ID parameter: `/start ref123` or `/start 123`
      const parts = textStr.split(" ");
      let referralId = null;
      if (parts.length > 1) {
        referralId = parts[1].replace("ref", ""); // Strip descriptive text if any
      }

      // 2. State Sync: Ensure user existence profile is stored
      const userRef = doc(db, "users", String(userId));
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        const finalReferrer = (referralId && String(referralId) !== String(userId)) ? String(referralId) : null;
        // Construct entity object matching criteria
        await firebase.firestore().collection("users").doc(String(userId)).set({
          id: String(userId),
          name: firstName || "Telegram User",
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
        await firebase.firestore().collection("users").doc(String(userId)).update({ frontendOpened: true });
      }

      // 3. Execution Pipeline: Fire one-time reward transactional check immediately
      await processReferralReward(userId);

      // 4. Outbound Interface Dispatcher
      const welcomeCaption = `👋 Hi! Welcome ${firstName || "User"} ⭐\nYaha aap tasks complete karke real rewards kama sakte ho!\n\n🔥 Daily Tasks\n🔥 Video Watch\n🔥 Mini Apps\n🔥 Referral Bonus\n🔥 Auto Wallet System\n\nReady to earn?\nTap START and your journey begins!`;

      const keyboardLayout = [
        [{ text: "▶ Open App", web_app: { url: WEBAPP_URL } }],
        [
          { text: "📢 Channel", url: CHANNEL_URL },
          { text: "🌐 Community", url: CHANNEL_URL }
        ]
      ];

      await sendTelegramMessage(chatId, welcomeCaption, keyboardLayout);
    }

    // Complete the event loop execution thread cleanly for Vercel environments
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("Top-level execution runtime error catching:", err);
    // Always return 200 to Telegram platform gateway endpoints to avoid retry loops locking function execution
    return res.status(200).send("Isolated error handoff occurred.");
  }
}
