# Folevi Server test build 1: install checklist

Two files, one per kind of Synology:

- **Folevi-Server-0.1.0-0001-x86_64.spk** for Intel or AMD models (most "+" models, such as DS923+, DS224+, DS1522+)
- **Folevi-Server-0.1.0-0001-aarch64.spk** for 64-bit ARM models (such as DS223, DS124, DS223j, DS423)

Not sure which one? In DSM, open **Control Panel > Info Center > General** and look at **CPU**. Intel or AMD: use
x86_64. Realtek RTD1296 or RTD1619B, or Marvell Armada 3720: use aarch64. Other ARM chips (Armada 385, Alpine)
are 32-bit and can't run Folevi Server.

Use a box with at least 2 GB of memory. This is a test build, so try it on data you don't mind losing.

## 1. Allow packages from Folevi

1. Open **Package Center**.
2. Open **Settings** (top right), then the **General** tab.
3. Under **Trust Level**, choose **Any publisher**, then **OK**.

## 2. Install

1. In Package Center, choose **Manual Install** (top right).
2. Choose the .spk file for this box, then **Next**.
3. DSM warns that the package isn't from Synology. Choose **Agree** (or **Yes**).
4. **Where Folevi keeps its data:** leave **folevi** and choose **Next**. DSM creates a shared folder with that name.
5. Choose **Done**. Package Center shows Folevi Server as **Running** after a moment.

The first start takes a few minutes while Folevi installs itself.

## 3. Set it up

1. Open the main menu (top left) and choose **Folevi Server**. If the icon isn't there, open
   `http://<your NAS address>:8810/folevi-server/` in a browser.
2. If it says it's starting, wait. It reloads by itself.
3. Give the server a name. Leave the address as it is (it's the address in your browser).
4. Leave the Foli AI key empty, unless you want to try Foli AI with a Gemini key.
5. Choose **Save and continue**.
6. **Write down the setup key** it shows.
7. Choose **Create your account** and sign up. You go straight into Folevi.

## 4. What to check

- [ ] Sign-up took you into Folevi's welcome steps, with no "check your inbox".
- [ ] Make a note and type something. Reload the page: it's still there.
- [ ] Make a folder.
- [ ] Search (⌘K or Ctrl+K) for a word from your note: the note shows up.
- [ ] Add an image to a note (type /image). Reload: the image is still there.
- [ ] Share a note with **Public link**, then open the link in a private window: the note shows.
- [ ] There's no Foli AI button and no "trial" or "Choose plan" anywhere (unless you gave an AI key).
- [ ] In Package Center, **Stop** Folevi Server, then **Run** it again. After a minute, your notes are still there.
- [ ] On the Folevi Server page, choose **Back up now**. After a minute, File Station shows a backup in
      **folevi > backups**.
- [ ] If you can, open Folevi from your phone's browser on the same Wi-Fi, at the same address.

If DSM's firewall is on and other devices can't reach it, allow port 8810 in **Control Panel > Security >
Firewall** (it's listed as Folevi Server).

## 5. Send back the diagnostics

For each box, whether it worked or not:

1. Open the main menu > **Folevi Server** > **Diagnostics**.
2. Choose **Copy diagnostics** and paste it into your message. (Or **Download as a file** and attach it.)
3. Also send the box's model, its memory, and anything above that didn't work.

**If the page doesn't open at all:** open **File Station > folevi > logs**, and send `launcher.log` and
`supervisor.log`. If there's no folevi folder, send a screenshot of Package Center's message.

## Not in this build yet

Email, push notifications, and signing in from the Mac, iPhone, iPad or Android apps (they still use Folevi Cloud).
Uninstalling keeps the folevi shared folder; delete it in **Control Panel > Shared Folder** if you want it gone.
