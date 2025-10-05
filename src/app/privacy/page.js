export default function PrivacyPolicy() {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
      <div className="space-y-6 text-muted-foreground">
        <p>Last updated: {new Date().toLocaleDateString()}</p>
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec
          laoreet, sapien ut iaculis vestibulum, ipsum erat tincidunt enim,
          ac eleifend magna nunc nec enim. Proin at commodo mi. Donec in
          imperdiet enim, sed aliquet enim. Sed vitae ex vitae est varius
          lobortis. Nullam et venenatis nunc. Nulla facilisi. Praesent
          euismod, elit eu consequat fermentum, nibh elit interdum tellus,
          in vehicula justo risus a est.
        </p>
        <h2 className="text-2xl font-semibold text-foreground pt-4">Information We Collect</h2>
        <p>
          Vivamus eu mi et nisl feugiat facilisis. Integer scelerisque,
          nibh in feugiat laoreet, nisi lorem consequat nunc, sed interdum
          nunc magna ac orci. Pellentesque habitant morbi tristique
          senectus et netus et malesuada fames ac turpis egestas. Mauris
          in pulvinar purus.
        </p>
        <h2 className="text-2xl font-semibold text-foreground pt-4">How We Use Your Information</h2>
        <p>
          Aenean nec quam a ex varius feugiat. Nam vulputate, justo in
          gravida malesuada, nulla purus interdum est, eget egestas neque
          sapien et magna. Curabitur vel turpis eu lacus consectetur
          dapibus. Nulla facilisi. In hac habitasse platea dictumst.
          Pellentesque habitant morbi tristique senectus et netus et
          malesuada fames ac turpis egestas.
        </p>
        <h2 className="text-2xl font-semibold text-foreground pt-4">Contact Us</h2>
        <p>
          If you have any questions about this Privacy Policy, please contact
          us at: contact@servizephyr.com
        </p>
      </div>
    </div>
  );
}
