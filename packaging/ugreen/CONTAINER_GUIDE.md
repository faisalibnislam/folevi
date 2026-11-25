# Folevi Server on UGREEN NAS (container route)

UGREEN's App Center only installs native `.upk` apps from developers UGREEN has authorized, and Folevi is not
authorized yet. Until it is, run Folevi Server with UGREEN's own Docker app. It is the exact same server as every
other Folevi package; you only paste one short file once.

Needs: a UGREEN DXP NAS on UGOS Pro, 2 GB of free memory (4 GB recommended), the Docker app from App Center.

1. **Make a shared folder.** Files > Shared folders > Create: name it `folevi`, on volume 1. (If you use another
   volume or name, change `/volume1/folevi` in step 3.)
2. **Open Docker.** App Center > Docker > Open. The first time, let it finish setting up.
3. **Create the project.** Docker > Project > Create. Project name: `folevi`. Storage path: the `folevi` shared
   folder. Choose "Create docker-compose.yml" and paste the contents of [`compose.yaml`](compose.yaml).
4. **Deploy.** Click Deploy (or Confirm). Docker downloads Folevi Server and starts it. Wait until the container
   shows "Running" (the first start takes a minute or two).
5. **Set it up.** In a browser, open `http://<your NAS address>:8460`. To see the setup address with its one-time
   code: Docker > Container > folevi > Terminal > Add > `sh`, then run
   `/opt/folevi/bin/folevid setup-url --data /data --bundle /opt/folevi`.
6. **Back it up.** Everything lives in the `folevi` shared folder; include it in your UGREEN backup plan.

Updates: Docker > Project > folevi > Update (pull the new image and recreate). Folevi Server takes a backup before
it migrates.

Screenshots to take for the published guide (on a real DXP, UGOS Pro current version): App Center with Docker;
Shared folder create dialog; Docker > Project > Create with the pasted file; the running container; the Folevi
setup page; the container terminal with the setup address. **Unverified: the menu names above come from UGREEN's
public docs and must be checked on a real UGOS Pro NAS.**
