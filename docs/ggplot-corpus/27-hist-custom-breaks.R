# ggplot2 reference: geom_histogram — breaks computed from quantiles
price_bins <- quantile(diamonds$price, probs = seq(0, 1, length = 11))
ggplot(diamonds, aes(price)) +
  geom_histogram(breaks = price_bins, color = "black")
