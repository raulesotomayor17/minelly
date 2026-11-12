FROM registry.fedoraproject.org/fedora:44
RUN dnf -y install \
    gcc gcc-c++ make pkgconf-pkg-config tar curl wget git which findutils \
    webkit2gtk4.1-devel gtk3-devel librsvg2-devel libappindicator-gtk3-devel \
    openssl-devel patchelf rpm-build rpmdevtools nodejs npm \
    && dnf clean all
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH=/root/.cargo/bin:$PATH
WORKDIR /workspace
