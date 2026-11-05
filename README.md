# Hexcheck

Search a Minecraft username and see what's left to max each of their Hypixel SkyBlock weapons, a bit like The Hex but from your browser.

It looks through the inventory, ender chest, backpacks and personal vault, then for each sword, longsword, bow or gauntlet shows:

- **Enchantments:** which ones aren't maxed, which are missing, and which are a pick-one choice because they conflict
- **Ultimate enchant:** the current one and its level, or the options if there isn't one
- **Books and upgrades:** Potato Books, Recombobulator, Art of War, reforge, stars, Master Stars, Wither scrolls, Power Scroll, Transmission Tuners, Etherwarp
- **Gemstones:** every slot, including locked ones and what they cost to unlock

## Run it

You need [Node.js](https://nodejs.org) 20 or newer. There's nothing to install.

1. Get a key at [developer.hypixel.net](https://developer.hypixel.net/).
2. Paste it after `HYPIXEL_API_KEY=` in the `.env` file.
3. Double-click `start.bat`, or run `npm start`. The site opens at http://localhost:3737.

The player being searched needs their Inventory API turned on: SkyBlock Menu, then Settings, then API Settings.

## Good to know

- Your key stays in `.env` on your computer. The browser only talks to the local server, and `.env` is in `.gitignore`. Hypixel's rules say not to enter keys into websites or put them in code, so please keep it that way.
- Developer keys expire. If searches start failing with a key error, make a new one and paste it in. No restart needed.
- The server only accepts connections from your own computer. To put it online for other people, apply for a Personal application on the Hypixel developer dashboard instead of relying on a developer key, and set `HOST` and `HYPIXEL_API_KEY` as environment variables on the host.
- The reforge check only confirms one is applied, because the best choice depends on your build.
- Enchant lists are by weapon type, so a few may not fit one specific weapon.

## Where the data comes from

Downloaded live and refreshed every 6 hours, so new enchants show up without changing the code once the sources add them:

- [Hypixel API](https://api.hypixel.net/): player inventories, and item stars and gem slots
- [NotEnoughUpdates repo](https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO): which enchants fit which weapons, and which conflict
- [SkyHanni repo](https://github.com/hannibal002/SkyHanni-REPO): enchant names and max levels

## Tests

```
npm test
```
