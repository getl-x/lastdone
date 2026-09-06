package com.getlx.lastdone;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class PackageNameTest {

    @Test
    public void mainActivityUsesReleasePackage() {
        assertEquals("com.getlx.lastdone", MainActivity.class.getPackageName());
    }
}
