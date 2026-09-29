#ifndef SAFENET_SDNS_H_
#define SAFENET_SDNS_H_

#include <stdint.h>

int64_t SafeNetFilterCreate(int tun_fd, const char *stamp, const char *policy);
int SafeNetFilterOutboundPacket(int64_t handle, const void *packet, int length);
int SafeNetFilterUpdatePolicy(int64_t handle, const char *policy);
void SafeNetFilterClose(int64_t handle);

#endif