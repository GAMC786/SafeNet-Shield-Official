package main

import "testing"

func TestSafeNetFilterResultContract(t *testing.T) {
	if got := safeNetFilterResult(true); got != 1 {
		t.Fatalf("pass result = %d, want 1", got)
	}
	if got := safeNetFilterResult(false); got != 0 {
		t.Fatalf("consumed/drop result = %d, want 0", got)
	}
}
