LOCAL_PATH := $(call my-dir)
include $(CLEAR_VARS)

# Keep the generic TPM API available to strongSwan's Android BYOD libraries.
# Android does not provide a TSS2 or trousers backend here, so the source
# files compile their existing no-backend stubs unless a backend is enabled.
LOCAL_SRC_FILES := \
	tpm_tss.c \
	tpm_tss_quote_info.c \
	tpm_tss_trousers.c \
	tpm_tss_tss2_v1.c \
	tpm_tss_tss2_v2.c \
	tpm_tss_tss2_names_v1.c \
	tpm_tss_tss2_names_v2.c \
	tpm_tss_tss2_session.c

LOCAL_C_INCLUDES += $(strongswan_PATH)/src/libstrongswan
LOCAL_CFLAGS := $(strongswan_CFLAGS)
LOCAL_MODULE := libtpmtss
LOCAL_MODULE_TAGS := optional
LOCAL_ARM_MODE := arm
LOCAL_PRELINK_MODULE := false
LOCAL_SHARED_LIBRARIES := libstrongswan

include $(BUILD_SHARED_LIBRARY)