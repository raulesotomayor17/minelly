FROM localhost/teoamoxtli-f44-builder:latest
RUN dnf -y install clang llvm lld mingw64-nsis zip unzip && dnf clean all
RUN curl -L --fail -o /tmp/nsis.zip 'https://sourceforge.net/projects/nsis/files/NSIS%203/3.11/nsis-3.11.zip/download' \
    && unzip -q /tmp/nsis.zip -d /tmp/nsis \
    && cp -a /tmp/nsis/nsis-3.11/Plugins/x86-unicode /usr/share/nsis/Plugins/ \
    && cp -a /tmp/nsis/nsis-3.11/Stubs/*-x86-unicode /usr/share/nsis/Stubs/ \
    && rm -rf /tmp/nsis /tmp/nsis.zip
RUN rustup target add x86_64-pc-windows-msvc
RUN cargo install cargo-xwin --locked
RUN printf '#!/bin/sh\nexec /root/.cargo/bin/cargo xwin "$@"\n' > /usr/local/bin/cargo-xwin-run && chmod +x /usr/local/bin/cargo-xwin-run
