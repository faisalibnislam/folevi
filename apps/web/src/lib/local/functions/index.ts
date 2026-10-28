// Registers every ported local handler (each module calls defineLocal when it loads). The modules are owned
// per work package (docs/LOCAL_MODE_PLAN.md §7, WP7a-e); add new ones here.
import "./sync";
import "./blocks";
import "./documents";
import "./documents.history";
import "./organization";
import "./users";
import "./settings";
import "./themes";
import "./workspaces";
import "./collections";
import "./charts";
import "./tasks";
import "./study";
import "./calendars";
import "./search";
import "./files";
import "./fileText";
import "./synced";
import "./imports";
import "./exports";
import "./migration";
import "./notices";
// A library's Vault (docs/MAC_REBUILD_PLAN.md §5.6).
import "./vault";
// Foli AI on the device or with the person's own key (WP11, lib/local/ai).
import "../ai/functions";
