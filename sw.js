const CACHE =
  "catchit-halle-v10";

const STATIC_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg"
];


self.addEventListener(
  "install",
  event => {

    self.skipWaiting();

    event.waitUntil(
      caches
        .open(CACHE)
        .then(
          cache =>
            cache.addAll(
              STATIC_FILES
            )
        )
    );
  }
);


self.addEventListener(
  "activate",
  event => {

    event.waitUntil(
      caches
        .keys()
        .then(keys =>

          Promise.all(
            keys

              .filter(
                key =>
                  key !== CACHE
              )

              .map(
                key =>
                  caches.delete(key)
              )
          )
        )

        .then(
          () =>
            self.clients.claim()
        )
    );
  }
);


self.addEventListener(
  "fetch",
  event => {

    const request =
      event.request;


    if (
      request.method !== "GET"
    ) {
      return;
    }


    const url =
      new URL(
        request.url
      );


    /*
      Nur eigene PWA-Dateien behandeln.
      INSA/Cloudflare-Anfragen niemals cachen.
    */

    if (
      url.origin !==
      self.location.origin
    ) {
      return;
    }


    event.respondWith(

      fetch(request)

        .then(response => {

          if (
            response.ok
          ) {

            const copy =
              response.clone();


            caches
              .open(CACHE)
              .then(
                cache =>
                  cache.put(
                    request,
                    copy
                  )
              );
          }


          return response;
        })


        .catch(
          () =>
            caches.match(
              request
            )
        )
    );
  }
);          cache.put(event.request, copy);
        });

        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
