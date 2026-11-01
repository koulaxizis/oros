# orOS add-on: privacy

The orOS add-on does not collect, sell or send any personal data. It
makes no network requests of its own and has no analytics.

- When you press "Save this page to orOS", use its shortcut or its
  right-click menu, it reads the address and title of that one page (or
  the address of the link you clicked) and opens orOS in a new tab with
  them in the address. Nothing is saved until you press Save in orOS.
- When you right-click selected text and choose "Ask the orOS
  Assistant", it opens orOS with that text after the `#` of the
  address, a part browsers never send to any server. orOS puts it in
  its Assistant's message box; nothing is sent until you press Send.
- Passwords: it keeps in your browser a copy of your orOS Passwords
  vault, read from an orOS tab you have open. The copy is encrypted
  exactly as orOS keeps it; without your master password nobody can
  read it. When you unlock, only the key that opens the vault is kept,
  in the browser's memory, until the lock time ends or the browser
  closes. Your master password is never stored.
- It fills a page only when you choose an entry in its window, and
  only with that entry. When a card number sits in a payment frame of
  another site, it names that site and asks the browser for access to
  it first. It never reads the pages you visit, except when you press
  "Save the login from this page": then it reads the name and password
  you typed on that page, asks you, and hands them to Passwords in your
  orOS tab, where they are saved only when you press Save.
- It stores its settings in your browser: the orOS address, the
  Passwords lock time. "Forget the vault copy" in its options removes
  the copy.

orOS itself keeps your data on your device; its optional sync is
encrypted on your device before it leaves it.
