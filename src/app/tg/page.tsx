import TelegramLanding from "@/components/TelegramLanding";

// Entry path for the Telegram Mini App. The bot's "Open app" button
// lands here; if the bot passed a startapp parameter (e.g. a room id)
// the landing component routes the user straight into that room.
// If there's no startapp we show a Create / Recent rooms picker.
//
// Bot-side setup: register https://whiteboard.a-worthy.com/tg as the
// Mini App URL with @BotFather. To deep-link a specific room, use
// https://t.me/<botname>/<appname>?startapp=<roomId>
export default function TelegramEntryPage() {
  return <TelegramLanding />;
}
