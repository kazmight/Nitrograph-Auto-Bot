## NitroGraph Auto BOT

*This is an automation bot for NitroGraph written in Node.js.
It automatically logs in with your wallet private keys, verifies referral code, fetches user data, claims daily credits, and performs daily check-in.*

✨ Features
- 🔑 Private keys from .env (no need to hardcode them in the script).
- 🌐 No proxy required – runs directly.
- 🎨 Colorized console logs with chalk.
- 🕹️ Interactive menu to Start or Exit the bot.
- 🔄 Automatic retry for failed requests.
- ⏳ 24-hour countdown before repeating the next cycle.

📝 Notes
- Make sure you have Node.js 18+ installed.
- Private keys are never sent or stored elsewhere; they are only used locally to sign login messages.
- Default referral code inside script is XVQ07AO5, replace it with your own if needed.
