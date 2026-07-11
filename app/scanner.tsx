// Scanner (spec/02 §D). Segmented barcode · label · photo.
//  - barcode (free): Open Food Facts + our packaged-goods table.
//  - label (free): OCR a nutrition panel or recipe. FLAG(nirmal): on-device OCR
//    needs a native ML module (Vision/MLKit) unavailable in Expo Go; the tab
//    frames the capture and hands off to the resolver's label path when the
//    module lands.
//  - photo (Plus): teaser card, then the paywall.
//
// A barcode hit becomes an ordinary journal line, so scanning rides the same
// write-through, offline, and recompute path as typing.

import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter, type Href } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Segmented } from '@/components/Segmented';
import { getPackagedFood, upsertPackagedFoodLocal } from '@/db/referenceRepo';
import { fetchOffProduct } from '@/lib/barcode';
import { queueLine } from '@/lib/pendingLine';
import { usePlus } from '@/lib/plus';
import { services } from '@/lib/services';
import { radius, screenPadding, spacing, type, useTheme } from '@/theme';

type Tab = 'barcode' | 'label' | 'photo';

// A default serving so a scan produces a real number; the user can edit the
// line. The resolver's packaged-food path reads qty + 'g'.
const DEFAULT_SERVING_G = 100;

export default function Scanner() {
  const { colors } = useTheme();
  const router = useRouter();
  const plus = usePlus();
  const [tab, setTab] = useState<Tab>('barcode');
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<string | null>(null);
  const scanning = useRef(false);

  const onBarcode = async (result: BarcodeScanningResult) => {
    if (scanning.current) return;
    scanning.current = true;
    setStatus('Looking up…');
    try {
      const svc = await services();
      const barcode = result.data;
      let food = await getPackagedFood(svc.adapter, barcode);
      if (!food) {
        const off = await fetchOffProduct(barcode);
        if (off) {
          await upsertPackagedFoodLocal(svc.adapter, {
            barcode: off.barcode,
            name: off.name,
            kcal_100g: off.kcal100g,
          });
          food = await getPackagedFood(svc.adapter, barcode);
        }
      }
      if (!food) {
        setStatus("That barcode isn't in our database yet. Try the label scanner.");
        setTimeout(() => (scanning.current = false), 1500);
        return;
      }
      // Queue a line the resolver maps to this barcode; the journal writes it.
      queueLine(`${DEFAULT_SERVING_G} g ${food.name}`);
      router.dismissAll();
    } catch {
      setStatus("Couldn't reach Slate. Try again.");
      setTimeout(() => (scanning.current = false), 1500);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Scan" />

      {tab === 'photo' ? (
        <View style={styles.teaser}>
          <Text style={[type.title, { color: colors.ink }]}>Snap a food</Text>
          <Text style={[type.label, styles.teaserBody, { color: colors.inkMute }]}>
            Take a photo and Slate estimates the nutrition. Available with Plus.
          </Text>
          <PrimaryButton
            label={plus ? 'Coming soon' : 'Try it out'}
            onPress={() => {
              if (!plus) router.push('/paywall' as Href);
            }}
          />
        </View>
      ) : !permission?.granted ? (
        <View style={styles.teaser}>
          <Text style={[type.label, styles.teaserBody, { color: colors.inkMute }]}>
            Slate needs the camera to scan.
          </Text>
          <PrimaryButton label="Allow camera" onPress={() => void requestPermission()} />
        </View>
      ) : (
        <View style={styles.cameraWrap}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={
              tab === 'barcode'
                ? { barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] }
                : undefined
            }
            onBarcodeScanned={tab === 'barcode' ? (r) => void onBarcode(r) : undefined}
          />
          {tab === 'label' && (
            <View style={styles.labelHint}>
              <Text style={[type.label, { color: '#FFFFFF' }]}>
                Point at a nutrition label. Reading labels arrives in the next build.
              </Text>
            </View>
          )}
          {status && (
            <View style={styles.statusBar}>
              <Text style={[type.label, { color: '#FFFFFF' }]}>{status}</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.tabs}>
        <Segmented
          options={[
            { value: 'barcode', label: 'barcode' },
            { value: 'label', label: 'label' },
            { value: 'photo', label: 'photo' },
          ]}
          value={tab}
          onChange={(v) => {
            setStatus(null);
            scanning.current = false;
            setTab(v);
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  cameraWrap: {
    flex: 1,
    margin: screenPadding,
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  labelHint: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
  },
  statusBar: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: 'rgba(17,18,20,0.7)',
    borderRadius: radius.chip,
    padding: spacing.md,
  },
  teaser: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: screenPadding,
    gap: spacing.md,
  },
  teaserBody: {
    marginBottom: spacing.md,
  },
  tabs: {
    paddingHorizontal: screenPadding,
    paddingVertical: spacing.md,
  },
});
