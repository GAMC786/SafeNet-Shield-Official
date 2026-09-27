cmake_minimum_required(VERSION 3.22.1)
project(SafeNetWireGuard)

set(WIREGUARD_TOOLS_DIR
    "${CMAKE_CURRENT_LIST_DIR}/../../third_party/wireguard-android/tunnel/tools")
add_subdirectory("${WIREGUARD_TOOLS_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/wireguard-tools")