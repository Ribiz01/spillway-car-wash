"use client";

import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { collection, doc, setDoc, query, where, getDocs, getDocsFromCache } from 'firebase/firestore';
import { useFirestore, useMemoFirebase, FirestorePermissionError, errorEmitter } from '@/firebase';
import { useSyncStatus } from '@/firebase/sync-status';
import { useUser } from "@/firebase/auth/use-user";
import { useCollection } from "@/firebase/firestore/use-collection";
import { useDoc } from "@/firebase/firestore/use-doc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import type { Customer, Service, Vehicle, Transaction, Washer } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { calcTier, customerIdForPhone, tierClasses } from "@/lib/loyalty";
import { locationStamp } from "@/lib/locations";
import { Check, ChevronLeft, ChevronRight, Loader2, Sparkles, Wind, Droplets, Car, Camera, Image as ImageIcon, Disc, Star, CloudOff, Pencil, Trophy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Checkbox } from "../ui/checkbox";
import { Skeleton } from "../ui/skeleton";
import { VehicleCamera } from "./vehicle-camera";
import { scanPlate } from "@/ai/flows/scan-plate-flow";

const vehicleSchema = z.object({
  licensePlate: z.string().min(3, "License plate is required").toUpperCase(),
});

const newVehicleSchema = z.object({
  licensePlate: z.string().min(3).toUpperCase(),
  make: z.string().optional(),
  model: z.string().optional(),
  type: z.enum(["Sedan", "SUV", "Truck", "Minibus"]),
  ownerName: z.string().optional(),
  phoneNumber: z.string().optional(),
  whatsappReceiptConsent: z.boolean(),
}).refine((data) => !data.whatsappReceiptConsent || (data.phoneNumber ?? "").replace(/\D/g, "").length >= 9, {
  // Consent to be messaged is meaningless without somewhere to send it.
  message: "Enter the customer's phone number to send receipts on WhatsApp.",
  path: ["phoneNumber"],
});

const servicesSchema = z.object({
  selectedServices: z.array(z.string()).min(1, "Please select at least one service."),
  bayNumber: z.string().optional(),
  // Optional at check-in: who will wash it is often not decided until the car
  // is on the ramp. It can be set or changed from Cars On Site at any time
  // before payment, and at least one washer is required to take payment.
  assignedWashers: z.array(z.string()),
});

type Step = "vehicle" | "new-vehicle" | "services";

/** Rough "how long ago", for the duplicate check-in warning. */
function waitedFor(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const serviceIcons: { [key: string]: React.ReactNode } = {
    'Exterior Wash': <Droplets className="h-6 w-6 text-primary" />,
    'Interior Vacuum': <Wind className="h-6 w-6 text-primary" />,
    'Wax & Polish': <Sparkles className="h-6 w-6 text-primary" />,
    'Engine Wash': <Car className="h-6 w-6 text-primary" />,
    'Tire Shine': <Disc className="h-6 w-6 text-primary" />,
    'Full Detail': <Star className="h-6 w-6 text-primary" />,
};

/**
 * Check-in. Records that a car has arrived and what is being done to it, then
 * leaves the job sitting as 'In Progress'.
 *
 * No washers and no payment are captured here — those belong to completion,
 * once the work is actually finished and the customer is at the till.
 */
export function Workflow() {
  const [step, setStep] = useState<Step>("vehicle");
  const [currentVehicle, setCurrentVehicle] = useState<Vehicle | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<'scan' | 'capture'>('capture');
  const [vehiclePhotoUri, setVehiclePhotoUri] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isFindingVehicle, setIsFindingVehicle] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isNewVehicleSaved, setIsNewVehicleSaved] = useState(false);
  /** True while the details form is correcting a known vehicle rather than registering one. */
  const [isEditingVehicle, setIsEditingVehicle] = useState(false);

  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { isOnline, isServerReachable } = useSyncStatus();
  // A slow link reports navigator.onLine === true while Firestore has already
  // fallen back to cache, so both signals are needed to tell the attendant the
  // truth about whether this check-in has actually left the tablet.
  const isWorkingOffline = !isOnline || !isServerReachable;

  const servicesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'services') : null, [firestore]);
  const { data: allServices, isLoading: isLoadingServices } = useCollection<Service>(servicesQuery);

  const washersQuery = useMemoFirebase(() => firestore ? collection(firestore, 'washers') : null, [firestore]);
  const { data: allWashers } = useCollection<Washer>(washersQuery);

  // Cars currently on site, so the same plate cannot be checked in twice. Same
  // single-field query shape as Cars On Site, so it costs no extra index.
  const activeJobsQuery = useMemoFirebase(
    () => firestore ? query(collection(firestore, 'transactions'), where('status', '==', 'In Progress')) : null,
    [firestore]
  );
  const { data: activeJobs } = useCollection<Transaction>(activeJobsQuery);

  // Loyalty standing of whoever owns the car being checked in. The customer id
  // is derived from the phone number, so this is a direct document read — it
  // works from cache offline and simply stays empty for a first-time customer.
  const customerId = customerIdForPhone(currentVehicle?.phoneNumber);
  const customerRef = useMemoFirebase(
    () => (firestore && customerId ? doc(firestore, 'customers', customerId) : null),
    [firestore, customerId]
  );
  const { data: customer } = useDoc<Customer>(customerRef);

  const vehicleForm = useForm<z.infer<typeof vehicleSchema>>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: { licensePlate: "" },
  });

  const newVehicleForm = useForm<z.infer<typeof newVehicleSchema>>({
    resolver: zodResolver(newVehicleSchema),
    defaultValues: {
      licensePlate: "",
      make: "",
      model: "",
      type: "Sedan",
      ownerName: "",
      phoneNumber: "",
      whatsappReceiptConsent: false,
    },
  });

  const servicesForm = useForm<z.infer<typeof servicesSchema>>({
    resolver: zodResolver(servicesSchema),
    defaultValues: { selectedServices: [], bayNumber: "", assignedWashers: [] },
  });

  const handleVehicleSubmit = async (data: z.infer<typeof vehicleSchema>) => {
    if (!firestore) return;

    // A plate already on site is nearly always a double check-in — two attendants
    // recording the same arrival. Two jobs for one car means one gets paid and
    // the other blocks the day from closing, so refuse it up front.
    const alreadyIn = activeJobs?.find((j) => j.licensePlate === data.licensePlate);
    if (alreadyIn) {
      toast({
        title: `${data.licensePlate} is already checked in`,
        description: `Added ${waitedFor(alreadyIn.timestamp)} ago${
          alreadyIn.userName ? ` by ${alreadyIn.userName}` : ''
        }. Find it in Cars On Site to take payment.`,
        variant: 'destructive',
      });
      return;
    }

    setIsFindingVehicle(true);
    try {
      const vehiclesRef = collection(firestore, 'vehicles');
      const q = query(vehiclesRef, where("licensePlate", "==", data.licensePlate));

      // Offline, getDocs can hang or reject waiting for the server. Fall back to
      // whatever the device already has cached so a known regular can still be
      // served during a network outage.
      //
      // This checks isWorkingOffline rather than navigator.onLine: on a link that
      // is up but too slow for Firestore, navigator.onLine is true, so getDocs
      // would stall for its full ~10s timeout before the catch below reached the
      // cache. That is an unacceptable wait with a car sitting at the bay.
      let querySnapshot;
      try {
        querySnapshot = isWorkingOffline ? await getDocsFromCache(q) : await getDocs(q);
      } catch {
        querySnapshot = await getDocsFromCache(q);
      }

      if (!querySnapshot.empty) {
        const found = { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() } as Vehicle;
        setCurrentVehicle(found);
        setStep("services");
      } else {
        newVehicleForm.setValue("licensePlate", data.licensePlate);
        setIsNewVehicleSaved(false);
        setIsEditingVehicle(false);
        setStep("new-vehicle");
      }
    } catch (error) {
        toast({ title: "Error", description: "Could not look up that plate. Register it as a new vehicle to continue.", variant: "destructive" });
    } finally {
        setIsFindingVehicle(false);
    }
  };

  const handleNewVehicleSubmit = async (data: z.infer<typeof newVehicleSchema>) => {
    if (!firestore) return;
    setIsSubmitting(true);
    // Firestore rejects `undefined` field values and does so SYNCHRONOUSLY, before
    // setDoc() ever returns a promise — so a `.catch()` below would not see it and
    // the whole handler would throw. Omit the key entirely when there is no photo.
    const details = {
      make: data.make?.trim() ?? "",
      model: data.model?.trim() ?? "",
      ownerName: data.ownerName?.trim() ?? "",
      phoneNumber: data.phoneNumber?.trim() ?? "",
      whatsappReceiptConsent: data.whatsappReceiptConsent,
      ...(vehiclePhotoUri ? { photoDataUri: vehiclePhotoUri } : {}),
    };
    const newVehicle: Omit<Vehicle, 'id'> = {
      licensePlate: data.licensePlate,
      type: data.type,
      ...details,
    };

    if (isEditingVehicle && currentVehicle?.id) {
      // Correcting a known vehicle: merge only the customer-facing details. The
      // security rules allow an attendant to change exactly these keys and
      // nothing else, so the plate and type are deliberately left out.
      const existingId = currentVehicle.id;
      setDoc(doc(firestore, 'vehicles', existingId), details, { merge: true }).catch(() => {
        errorEmitter.emit(
          'permission-error',
          new FirestorePermissionError({
            path: `vehicles/${existingId}`,
            operation: 'update',
            requestResourceData: details,
          })
        );
      });
      setCurrentVehicle({ ...currentVehicle, ...details });
      setIsEditingVehicle(false);
      setIsSubmitting(false);
      setStep("services");
      toast({ title: "Details updated", description: `${currentVehicle.licensePlate} has been updated.` });
      return;
    }

    const vehicleRef = doc(firestore, 'vehicles', data.licensePlate);

    // Non-blocking write: Firestore resolves this promise only after the SERVER
    // acknowledges, which never happens offline. We commit to local cache and
    // move on; the SDK replays the write when connectivity returns.
    setDoc(vehicleRef, newVehicle).catch(() => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: `vehicles/${data.licensePlate}`,
          operation: 'create',
          requestResourceData: newVehicle,
        })
      );
    });

    setCurrentVehicle({ id: data.licensePlate, ...newVehicle });
    setIsNewVehicleSaved(true);
    setIsSubmitting(false);
    toast({
      title: "Vehicle Registered",
      description: !isWorkingOffline
        ? `${data.licensePlate} has been saved.`
        : `${data.licensePlate} saved on this device. It will upload when you're back online.`,
    });
  };

  /** Records the arrival. The job is now 'In Progress' until someone completes it. */
  const handleCheckIn = async (data: z.infer<typeof servicesSchema>) => {
    if (!currentVehicle || !user || !firestore || !allServices) return;
    setIsSubmitting(true);

    const selectedServices = allServices.filter(s => data.selectedServices.includes(s.id));
    const totalAmount = selectedServices.reduce((acc, s) => acc + s.price, 0);
    const assignedWashers = (allWashers ?? [])
      .filter((w) => data.assignedWashers.includes(w.id))
      .map((w) => ({ id: w.id, name: w.name }));

    // No `payment` key yet: it is set at completion. Writing a placeholder
    // payment here would make an unwashed car look like a sale. Washers are
    // recorded now if they were chosen, and can still be changed before payment.
    const newJob: Omit<Transaction, 'id'> = {
      timestamp: new Date().toISOString(),
      licensePlate: currentVehicle.licensePlate,
      services: selectedServices.map(s => ({ id: s.id, name: s.name, price: s.price })),
      totalAmount,
      userId: user.uid,
      userName: user.profile?.name || user.email || 'Unknown',
      status: 'In Progress',
      // Copied onto the job so receipts, loyalty and reports need no second read
      // at the till. Firestore rejects `undefined`, so each is spread in only
      // when there is a value.
      ...locationStamp(user.profile),
      ...(assignedWashers.length > 0 ? { assignedWashers } : {}),
      ...(currentVehicle.make ? { vehicleMake: currentVehicle.make } : {}),
      ...(currentVehicle.model ? { vehicleModel: currentVehicle.model } : {}),
      ...(data.bayNumber?.trim() ? { bayNumber: data.bayNumber.trim() } : {}),
      ...(currentVehicle.ownerName ? { customerName: currentVehicle.ownerName } : {}),
      ...(currentVehicle.phoneNumber ? { customerPhone: currentVehicle.phoneNumber } : {}),
      whatsappReceiptConsent: currentVehicle.whatsappReceiptConsent === true,
    };

    // Generate the document ID locally rather than letting addDoc round-trip to
    // the server. This is what makes check-in work offline: we write into the
    // local cache and Firestore replays it when the connection comes back.
    const jobRef = doc(collection(firestore, 'transactions'));

    setDoc(jobRef, newJob).catch(() => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: `transactions/${jobRef.id}`,
          operation: 'create',
          requestResourceData: newJob,
        })
      );
      toast({
        title: "Check-In Rejected",
        description: "The server refused this car. Check the console and record it again.",
        variant: "destructive",
      });
    });

    toast({
      title: `${currentVehicle.licensePlate} checked in`,
      description: isWorkingOffline
        ? "Saved on this device. It will upload automatically."
        : "It's now in Cars On Site. Take payment there when the wash is done.",
    });

    startNew();
    setIsSubmitting(false);
  };

  const handlePhotoCaptured = async (imageDataUri: string) => {
    setIsCameraOpen(false);
    if (cameraMode === 'capture') {
        setVehiclePhotoUri(imageDataUri);
        toast({ title: "Photo captured!" });
    } else if (cameraMode === 'scan') {
        setIsScanning(true);
        toast({ title: "Scanning License Plate...", description: "This might take a moment." });
        try {
            const result = await scanPlate({ photoDataUri: imageDataUri });
            if (result && result.licensePlate) {
                vehicleForm.setValue('licensePlate', result.licensePlate);
                toast({
                    title: "Scan Successful!",
                    description: `License plate set to ${result.licensePlate}.`,
                });
            } else {
                toast({
                    variant: "destructive",
                    title: "Scan Failed",
                    description: "Could not read the license plate. Please try again or enter it manually.",
                });
            }
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Scan Error",
                description: "An unexpected error occurred during the scan.",
            });
        } finally {
            setIsScanning(false);
        }
    }
  };

  const startNew = () => {
    vehicleForm.reset({ licensePlate: "" });
    newVehicleForm.reset({ licensePlate: "", make: "", model: "", type: "Sedan", ownerName: "", phoneNumber: "", whatsappReceiptConsent: false });
    servicesForm.reset({ selectedServices: [], bayNumber: "", assignedWashers: [] });
    setCurrentVehicle(null);
    setVehiclePhotoUri(null);
    setIsNewVehicleSaved(false);
    setIsEditingVehicle(false);
    setStep("vehicle");
  };

  /** Reopens the details form for a known vehicle, e.g. to add a missing phone number. */
  const editVehicleDetails = () => {
    if (!currentVehicle) return;
    newVehicleForm.reset({
      licensePlate: currentVehicle.licensePlate,
      make: currentVehicle.make ?? "",
      model: currentVehicle.model ?? "",
      type: currentVehicle.type ?? "Sedan",
      ownerName: currentVehicle.ownerName ?? "",
      phoneNumber: currentVehicle.phoneNumber ?? "",
      whatsappReceiptConsent: currentVehicle.whatsappReceiptConsent === true,
    });
    setVehiclePhotoUri(null);
    setIsNewVehicleSaved(false);
    setIsEditingVehicle(true);
    setStep("new-vehicle");
  };

  const motionProps = {
    initial: { opacity: 0, x: 50 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -50 },
    transition: { duration: 0.3 }
  };

  const renderStep = () => {
    switch (step) {
      case "vehicle":
        return (
          <motion.div {...motionProps}>
          <Card>
            <CardHeader>
              <CardTitle>1. Vehicle Identification</CardTitle>
              <CardDescription>Enter the vehicle&apos;s license plate or scan it.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...vehicleForm}>
                <form onSubmit={vehicleForm.handleSubmit(handleVehicleSubmit)} className="space-y-4">
                  <FormField
                    control={vehicleForm.control}
                    name="licensePlate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Plate</FormLabel>
                        <div className="relative">
                            <FormControl>
                            <Input placeholder="e.g., ABC 1234" {...field} />
                            </FormControl>
                            <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1 h-8 w-8"
                            onClick={() => {
                                setCameraMode('scan');
                                setIsCameraOpen(true);
                            }}
                            disabled={isScanning}
                            >
                            {isScanning ? <Loader2 className="animate-spin" /> : <Camera className="size-5" />}
                            <span className="sr-only">Scan License Plate</span>
                            </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={isScanning || isFindingVehicle || isLoadingServices}>
                    {isFindingVehicle && <Loader2 className="animate-spin mr-2" />}
                    {isFindingVehicle ? 'Finding...' : 'Find Vehicle'}
                     <ChevronRight className="ml-2" />
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
          </motion.div>
        );
      case "new-vehicle":
        return (
            <motion.div {...motionProps}>
            <Card>
            <CardHeader>
              <CardTitle>{isEditingVehicle ? "Update Vehicle Details" : "Register New Vehicle"}</CardTitle>
              <CardDescription>
                {isEditingVehicle
                  ? "Correct the customer's details. A phone number is what earns them loyalty points and a receipt."
                  : "This license plate is not in our system. Please add the vehicle details."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...newVehicleForm}>
                <form onSubmit={newVehicleForm.handleSubmit(handleNewVehicleSubmit)} className="space-y-4">
                   <div className="space-y-2">
                      <FormLabel>Vehicle Photo</FormLabel>
                      <Card>
                          <CardContent className="p-2">
                              <div className="aspect-video w-full bg-muted rounded-md flex items-center justify-center overflow-hidden">
                                  {(vehiclePhotoUri || (isEditingVehicle && currentVehicle?.photoDataUri)) ? (
                                      <img src={vehiclePhotoUri || currentVehicle?.photoDataUri} alt="Vehicle" className="h-full w-full object-cover rounded-md" />
                                  ) : (
                                      <ImageIcon className="size-12 text-muted-foreground" />
                                  )}
                              </div>
                          </CardContent>
                          <CardFooter className="p-2 pt-0">
                              <Button type="button" variant="outline" className="w-full" onClick={() => {
                                  setCameraMode('capture');
                                  setIsCameraOpen(true);
                              }}
                              disabled={isSubmitting || isNewVehicleSaved}>
                                  <Camera className="mr-2" /> {vehiclePhotoUri ? 'Retake' : 'Capture'} Photo
                              </Button>
                          </CardFooter>
                      </Card>
                  </div>

                  <FormField control={newVehicleForm.control} name="licensePlate" render={({ field }) => (
                    <FormItem><FormLabel>License Plate</FormLabel><FormControl><Input {...field} disabled /></FormControl><FormMessage /></FormItem>
                  )}/>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={newVehicleForm.control} name="make" render={({ field }) => (
                      <FormItem><FormLabel>Make (Optional)</FormLabel><FormControl><Input placeholder="Toyota" {...field} disabled={isSubmitting || isNewVehicleSaved} /></FormControl><FormMessage /></FormItem>
                    )}/>
                    <FormField control={newVehicleForm.control} name="model" render={({ field }) => (
                      <FormItem><FormLabel>Model (Optional)</FormLabel><FormControl><Input placeholder="Hilux" {...field} disabled={isSubmitting || isNewVehicleSaved} /></FormControl><FormMessage /></FormItem>
                    )}/>
                  </div>
                  <FormField control={newVehicleForm.control} name="type" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vehicle Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isSubmitting || isNewVehicleSaved || isEditingVehicle}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select vehicle type" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="Sedan">Sedan</SelectItem>
                          <SelectItem value="SUV">SUV</SelectItem>
                          <SelectItem value="Truck">Truck</SelectItem>
                          <SelectItem value="Minibus">Minibus</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}/>
                  <FormField control={newVehicleForm.control} name="ownerName" render={({ field }) => (
                    <FormItem><FormLabel>Owner Name (Optional)</FormLabel><FormControl><Input placeholder="John Doe" {...field} disabled={isSubmitting || isNewVehicleSaved}/></FormControl><FormMessage /></FormItem>
                  )}/>
                   <FormField control={newVehicleForm.control} name="phoneNumber" render={({ field }) => (
                    <FormItem><FormLabel>Phone Number (for WhatsApp &amp; loyalty points)</FormLabel><FormControl><Input inputMode="tel" placeholder="0977123456" {...field} disabled={isSubmitting || isNewVehicleSaved} /></FormControl><FormMessage /></FormItem>
                  )}/>
                  <FormField control={newVehicleForm.control} name="whatsappReceiptConsent" render={({ field }) => (
                    <FormItem className="flex flex-row items-start gap-3 space-y-0 rounded-md border p-3">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} disabled={isSubmitting || isNewVehicleSaved} />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="font-normal">Customer agrees to receive receipts on WhatsApp</FormLabel>
                        <p className="text-xs text-muted-foreground">Ask before ticking. Receipts are only sent automatically with this on.</p>
                      </div>
                    </FormItem>
                  )}/>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => { if (isEditingVehicle) { setIsEditingVehicle(false); setVehiclePhotoUri(null); setStep("services"); } else { setStep("vehicle"); } }} disabled={isSubmitting || isNewVehicleSaved}>
                      <ChevronLeft className="mr-2" />Back
                    </Button>
                    {!isNewVehicleSaved ? (
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 animate-spin" />}
                            {isEditingVehicle ? "Save Details" : "Register Vehicle"}
                        </Button>
                    ) : (
                        <Button type="button" onClick={() => setStep("services")}>
                            Continue to Services <ChevronRight className="ml-2" />
                        </Button>
                    )}
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
          </motion.div>
        );
      case "services": {
        const selectedIds = servicesForm.watch("selectedServices");
        const selected = allServices?.filter(s => selectedIds.includes(s.id)) || [];
        const total = selected.reduce((acc, s) => acc + s.price, 0);

        return (
            <motion.div {...motionProps} className="grid md:grid-cols-3 gap-6">
                <div className="md:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>2. What is being done?</CardTitle>
                            <CardDescription>
                                Select the work for {currentVehicle?.licensePlate}. You can still change
                                this when you take payment.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                            <div className="min-w-0 text-sm">
                                <p className="font-medium">
                                    {[currentVehicle?.make, currentVehicle?.model].filter(Boolean).join(" ") || currentVehicle?.type || "Vehicle"}
                                    {currentVehicle?.ownerName ? ` · ${currentVehicle.ownerName}` : ""}
                                </p>
                                {customer ? (
                                    <Badge variant="outline" className={`mt-1 gap-1 ${tierClasses[calcTier(customer.totalPoints ?? 0)]}`}>
                                        <Trophy className="h-3 w-3" />
                                        {calcTier(customer.totalPoints ?? 0)} · {customer.totalPoints ?? 0} pts · {customer.totalVisits ?? 0} visits
                                    </Badge>
                                ) : (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {currentVehicle?.phoneNumber
                                            ? "First visit on record — this wash starts their loyalty points."
                                            : "No phone number saved, so no loyalty points or WhatsApp receipt."}
                                    </p>
                                )}
                            </div>
                            <Button type="button" variant="ghost" size="sm" onClick={editVehicleDetails}>
                                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit details
                            </Button>
                        </div>
                        <Form {...servicesForm}>
                            <form onSubmit={servicesForm.handleSubmit(handleCheckIn)}>
                                <FormField control={servicesForm.control} name="selectedServices" render={() => (
                                    <FormItem className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {isLoadingServices && <>
                                          <Skeleton className="h-24 w-full" />
                                          <Skeleton className="h-24 w-full" />
                                        </>}
                                        {allServices?.map((service) => (
                                        <FormField key={service.id} control={servicesForm.control} name="selectedServices" render={({ field }) => (
                                            <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                                            <Card className={`w-full cursor-pointer hover:border-primary transition-colors ${field.value?.includes(service.id) ? "border-primary border-2" : ""}`}>
                                                <CardContent className="p-4">
                                                    <FormControl>
                                                        <Checkbox className="hidden" checked={field.value?.includes(service.id)} onCheckedChange={(checked) => {
                                                            return checked ? field.onChange([...field.value, service.id]) : field.onChange(field.value?.filter((value) => value !== service.id));
                                                        }} />
                                                    </FormControl>
                                                    <FormLabel className="font-normal w-full flex items-center justify-between cursor-pointer">
                                                        <div className="flex items-center gap-3">
                                                            {serviceIcons[service.name] || <Car className="h-6 w-6 text-primary" />}
                                                            <span className="text-lg font-medium">{service.name}</span>
                                                        </div>
                                                        <span className="text-lg font-bold">{formatCurrency(service.price)}</span>
                                                    </FormLabel>
                                                </CardContent>
                                            </Card>
                                            </FormItem>
                                        )} />
                                    ))}
                                    <FormMessage className="col-span-full" />
                                </FormItem>
                                )}/>
                                <FormField control={servicesForm.control} name="bayNumber" render={({ field }) => (
                                    <FormItem className="mt-4 max-w-[200px]">
                                        <FormLabel>Bay (Optional)</FormLabel>
                                        <FormControl><Input placeholder="e.g., 2" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}/>
                                <FormField control={servicesForm.control} name="assignedWashers" render={({ field }) => (
                                    <FormItem className="mt-4">
                                        <FormLabel>Who is washing it? (Optional)</FormLabel>
                                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                            {allWashers?.map((w) => {
                                                const on = field.value.includes(w.id);
                                                return (
                                                    <button
                                                        type="button"
                                                        key={w.id}
                                                        aria-pressed={on}
                                                        onClick={() => field.onChange(on ? field.value.filter((id) => id !== w.id) : [...field.value, w.id])}
                                                        className={`flex items-center gap-2 rounded-md border p-2.5 text-left text-sm transition-colors hover:border-primary ${on ? "border-primary border-2" : ""}`}
                                                    >
                                                        <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary ${on ? "bg-primary text-primary-foreground" : ""}`}>
                                                            {on && <Check className="h-3 w-3" />}
                                                        </span>
                                                        <span className="truncate">{w.name}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {allWashers?.length === 0
                                                ? "No washers set up — ask an admin to add them."
                                                : "You can set or change this later from Cars On Site, before payment."}
                                        </p>
                                    </FormItem>
                                )}/>
                            </form>
                        </Form>
                        </CardContent>
                    </Card>
                </div>
                <div className="md:col-span-1">
                    <Card className="sticky top-20">
                        <CardHeader><CardTitle>Order Summary</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            {selected.length > 0 ? selected.map(s => (
                                <div key={s.id} className="flex justify-between"><span>{s.name}</span><span className="font-medium">{formatCurrency(s.price)}</span></div>
                            )) : <p className="text-muted-foreground">No services selected.</p>}
                            <Separator />
                            <div className="flex justify-between text-xl font-bold"><span>Total</span><span>{formatCurrency(total)}</span></div>
                            {isWorkingOffline && (
                                <Alert className="border-amber-500/40 bg-amber-500/5">
                                    <CloudOff className="h-4 w-4 text-amber-600" />
                                    <AlertTitle className="text-amber-700">Working offline</AlertTitle>
                                    <AlertDescription className="text-amber-700/90 text-xs">
                                        Carry on as normal. This check-in is saved to the tablet and
                                        uploads by itself when signal returns.
                                    </AlertDescription>
                                </Alert>
                            )}
                        </CardContent>
                        <CardFooter className="flex flex-col gap-2">
                            <Button
                                className="w-full"
                                onClick={servicesForm.handleSubmit(handleCheckIn)}
                                disabled={selected.length === 0 || isSubmitting}
                            >
                                {isSubmitting && <Loader2 className="animate-spin mr-2" />}
                                <Check className="mr-2" /> Check In Car
                            </Button>
                            <Button className="w-full" variant="outline" type="button" onClick={startNew}>
                                <ChevronLeft className="mr-2" />Cancel
                            </Button>
                        </CardFooter>
                    </Card>
                </div>
            </motion.div>
        );
      }
    }
  };

  return (
    <>
      <AnimatePresence mode="wait">{renderStep()}</AnimatePresence>
      <AnimatePresence>
      {isCameraOpen && (
        <VehicleCamera
          onCapture={handlePhotoCaptured}
          onClose={() => setIsCameraOpen(false)}
        />
      )}
      </AnimatePresence>
    </>
  );
}
