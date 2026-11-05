# Hexcheck

See what's left to max each of a player's Hypixel SkyBlock weapons, a bit like The Hex but in your browser.

It looks through the inventory, ender chest, backpacks and personal vault, then for each sword, longsword, bow or gauntlet shows:

- **Enchantments:** which ones aren't maxed, which are missing, and which are a pick-one choice because they conflict
- **Ultimate enchant:** the current one and its level, or the options if there isn't one
- **Books and upgrades:** Potato Books, Recombobulator, Art of War, reforge, stars, Master Stars, Wither scrolls, Power Scroll, Transmission Tuners, Etherwarp
- **Reforge suggestions:** what players use on upgraded copies of that weapon on the auction house, with each reforge's stats at the item's rarity and where to get it
- **Gemstones:** every slot, including locked ones and what they cost to unlock

## Setup

1. In the repo, go to **Settings > Secrets and variables > Actions** and add a secret named `HYPIXEL_API_KEY`.
2. Go to **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Add Minecraft usernames to [players.txt](players.txt), one per line, then commit and push.

The site rebuilds in about a minute.

## How it works

GitHub Pages only serves static files, so it can't keep a key secret or call Hypixel when someone searches. Instead, a GitHub Action does the Hypixel work and publishes the finished results:

- **Only players in `players.txt` can be searched.** Add a name and push, and it appears after the rebuild.
- **Data refreshes every 6 hours.** To refresh right now, open the **Actions** tab, pick **Build and deploy Hexcheck**, and click **Run workflow**. The page shows when its data is from.
- **Your key never reaches the site.** It only exists while the Action runs, and the build refuses to publish if the key shows up in any output file. Never put the key in a file in this repo.
- **Listed players' weapons are public.** Anyone with the link can see them, so only list people who are fine with that.
- **A failed build changes nothing.** If Hypixel rejects the key or is down, the Action fails, GitHub emails you, and the last good version stays online.

## Good to know

- The player needs their Inventory API on: SkyBlock Menu, then Settings, then API Settings.
- Hypixel's rules say not to rely on developer keys long term. For a site that stays up, apply for a Personal application on the [developer dashboard](https://developer.hypixel.net/). When a key expires, update the secret and re-run the Action.
- GitHub pauses scheduled runs if a public repo has no activity for 60 days. Pushing anything, or re-enabling the workflow from the Actions tab, starts them again.
- Reforge suggestions show what's popular, not a calculated best, and they don't affect the score. Any reforge counts as done because the best choice depends on your build.
- Enchant lists are by weapon type, so a few may not fit one specific weapon.

## Where the data comes from

Downloaded fresh on every build, so new enchants and weapons show up without changing the code once the sources add them:

- [Hypixel API](https://api.hypixel.net/): player inventories, item stars and gem slots, and auction listings
- [NotEnoughUpdates repo](https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO): which enchants fit which weapons, which conflict, and reforge stats
- [SkyHanni repo](https://github.com/hannibal002/SkyHanni-REPO): enchant names and max levels

## Tests

```
npm test
```
