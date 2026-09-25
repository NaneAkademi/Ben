import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;

import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;

/**
 * Android SDK olmadan APK imzalamak için küçük yardımcı (apksig kütüphanesi).
 * Kullanım: java -cp apksig.jar ApkSign.java sign keystore pass alias in.apk out.apk minSdk
 *           java -cp apksig.jar ApkSign.java verify file.apk
 */
public class ApkSign {
    public static void main(String[] a) throws Exception {
        if (a[0].equals("verify")) {
            ApkVerifier.Result r = new ApkVerifier.Builder(new File(a[1])).build().verify();
            System.out.println("verified=" + r.isVerified() + " v1=" + r.isVerifiedUsingV1Scheme() + " v2=" + r.isVerifiedUsingV2Scheme());
            for (ApkVerifier.IssueWithParams e : r.getErrors()) System.out.println("ERROR " + e);
            if (!r.isVerified()) System.exit(1);
            return;
        }
        KeyStore ks = KeyStore.getInstance("PKCS12");
        char[] pw = a[2].toCharArray();
        try (FileInputStream in = new FileInputStream(a[1])) {
            ks.load(in, pw);
        }
        PrivateKey key = (PrivateKey) ks.getKey(a[3], pw);
        X509Certificate cert = (X509Certificate) ks.getCertificate(a[3]);
        ApkSigner.SignerConfig cfg = new ApkSigner.SignerConfig.Builder("SIPER", key, Collections.singletonList(cert)).build();
        new ApkSigner.Builder(Collections.singletonList(cfg))
                .setInputApk(new File(a[4]))
                .setOutputApk(new File(a[5]))
                .setMinSdkVersion(Integer.parseInt(a[6]))
                .setV1SigningEnabled(false) // minSdk 24: v2 yeterli
                .setV2SigningEnabled(true)
                .build()
                .sign();
        System.out.println("imzalandi: " + a[5]);
    }
}
