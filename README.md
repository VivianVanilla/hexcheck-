# Hexcheck

Search any Minecraft username and see what's left to max each of their Hypixel SkyBlock weapons, a bit like The Hex but in your browser.

It looks through the inventory, ender chest, backpacks and personal vault, then for each sword, longsword, bow or gauntlet shows:

- **Enchantments:** which ones aren't maxed, which are missing, and which are a pick-one choice because they conflict
- **Ultimate enchant:** the current one and its level, or the options if there isn't one
- **Books and upgrades:** Potato Books, Recombobulator, Art of War, reforge, stars, Master Stars, Wither scrolls, Power Scroll, Transmission Tuners, Etherwarp
- **Reforge suggestions:** what players use on upgraded copies of that weapon on the auction house, with each reforge's stats at the item's rarity and where to get it
- **Gemstones:** every slot, including locked ones and what they cost to unlock

## Deploy to Vercel

1. On [vercel.com](https://vercel.com/new), import this GitHub repo. Leave the build settings as they are.
2. Under **Environment Variables**, add `HYPIXEL_API_KEY` with your key from the [Hypixel developer dashboard](https://developer.hypixel.net/).
3. Click **Deploy**.

After that, every push to `main` redeploys the site automatically.

## How it works

- **The page** (`public/`) is plain static files. It never sees the key.
- **The function** (`api/weapons.js`) holds the key, asks Hypixel about the player, and sends back the finished results. Vercel's CDN answers repeat searches for the same player for a couple of minutes, so they don't use up the key's rate limit. The page shows when its data is from.
- **Enchant and item data** is downloaded by the function and kept for up to 6 hours, so new enchants and weapons show up without changing the code once the sources add them.
- **Reforge usage** (`data/reforge-usage.json`) is saved in the repo, because scanning every auction page takes too long to do during a search. An Action refreshes it on the first of each month, and the push redeploys the site. To refresh sooner, open the **Actions** tab, pick **Refresh reforge data**, and click **Run workflow**.

## Good to know

- The player needs their Inventory API on: SkyBlock Menu, then Settings, then API Settings.
- Vercel only applies a changed environment variable to new deployments. After updating the key, go to **Deployments** and redeploy the latest one.
- Hypixel's rules say not to rely on developer keys long term. For a site that stays up, apply for a Personal application on the [developer dashboard](https://developer.hypixel.net/). Everyone using the site shares that key's rate limit, and searches stop working if it expires until you replace it.
- Vercel's free Hobby plan is for non-commercial use, so ads or payments would mean upgrading.
- Reforge suggestions show what's popular, not a calculated best, and they don't affect the score. Any reforge counts as done because the best choice depends on your build.
- Enchant lists are by weapon type, so a few may not fit one specific weapon.

## Where the data comes from

- [Hypixel API](https://api.hypixel.net/): player inventories, item stars and gem slots, and auction listings
- [NotEnoughUpdates repo](https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO): which enchants fit which weapons, which conflict, and reforge stats
- [SkyHanni repo](https://github.com/hannibal002/SkyHanni-REPO): enchant names and max levels

## Commands

```
npm test                  # run the tests
npm run update-reforges   # rescan the auction house and rewrite data/reforge-usage.json
```
